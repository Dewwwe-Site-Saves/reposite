# Reposite

Self-hosted backup manager for WordPress websites. Downloads files via FTP/SFTP, dumps the database, and pushes everything to a GitHub repository. Web UI to manage sites, run backups, follow logs and schedule everything.

## Usage

```bash
npm install
cp .env.example .env   # fill in the secrets
npm run db:migrate     # create / update the database

# Dev
npm run dev

# Production
npm run build
npm run start

# Checks
npm run typecheck
npm test
```

First start opens a setup page to create the admin account (email + password, 12 characters minimum), then lands on Settings: fill in the GitHub commit author and token first, the sites come next. The password can be changed from the Account section of Settings. Lost password:

```bash
npx tsx scripts/reset-password.ts admin@example.com   # prints a generated password
```

## Config

Environment variables, see [.env.example](./.env.example):

- `DATA_DIR` — database, site clones and certificates
- `ENCRYPTION_KEY` — encrypts stored passwords and tokens
- `SESSION_SECRET` — signs the session cookie
- `SESSION_COOKIE_SECURE` — `false` to allow the session cookie over plain HTTP (production marks it Secure by default)
- `TZ` — timezone for cron schedules
- `APP_URL` — public URL of the instance, for the links in notification mails (optional)

### GitHub

Fine-grained personal access token restricted to the backup repos, with `Contents: read/write` and `Metadata: read`. Stored encrypted, used for pushes and releases. The "Test token" button in Settings checks the token against GitHub and the push access to every site's repository; the commit author name and email are configured next to it.

> Backup repos must be **private**: they contain `wp-config.php` and the full database dump.

### Notifications

Settings has an SMTP block (host, port, TLS / STARTTLS / none, credentials, sender, recipients) and an "Errors" switch. When it is on, every failed run sends a mail with the error, the dates and the last lines of the log, and a restart that interrupts backups sends one mail listing them. "Send test mail" checks the block before saving. The password is stored encrypted, the switch cannot be turned on while the block is incomplete, and a mail that cannot be sent is only logged in the container output: notifications never affect a backup.

### SharePoint List update

The app can update a date field in a SharePoint list after each backup.

1. Go to https://portal.azure.com, App Registrations, "New Registration"
2. Under "API Permissions" add the application permission SharePoint/Sites.ReadWrite.All
3. Generate a certificate:
```bash
openssl req -x509 -newkey rsa:2048 -keyout keytmp.pem -out cert.pem -days 365 -passout pass:HereIsMySuperPass -subj '/CN=reposite'
openssl rsa -in keytmp.pem -out key.pem -passin pass:HereIsMySuperPass
```
4. Upload `cert.pem` to the App Registration under "Certificates & secrets" and copy the thumbprint
5. Put `key.pem` in `$DATA_DIR/sp-certificates/`
6. Fill in the SharePoint section in Settings, then set the list item ID on each site

> Certificates expire and you will have to regenerate it every year!!

## How it works

The app runs the following steps for each site:

1. **Git clone or fetch** the backup repo and reset it on the remote default branch
2. **Cleanup leftover artifacts** — removes old SQL dumps, tokens and PHP scripts left by previous runs on the remote server
3. **Token authentication** — generates a unique token, uploads its hash via FTP/SFTP
4. **Database dump** — uploads `backup-wp.php` to the site, triggers it via HTTPS with the token in a header. The PHP script self-deletes after execution
5. **Dump download & validation** — downloads the SQL file right away to `db.sql` at the root of the repo, verifies it is not empty and contains valid SQL, deletes it from the remote server
6. **Incremental download** — scans remote files and only downloads those that changed (different size or modification date). FTP uses a pool of 5 parallel connections, SFTP 3
7. **Git commit, tag & push** — one commit per run with a UTC tag (`YYYYMMDD-HHmmss`); nothing is committed when nothing changed
8. **GitHub release** — one release per backup on the tag, with the run stats
9. **SharePoint update** — updates the last backup date in the SharePoint list (optional)

## Security

- The web UI and API are behind a login: one admin account created at first run, session in a signed `httpOnly` cookie (7 days), no default credentials
- Login attempts are throttled per address (5 failures, 15 minutes lockout)
- Passwords and tokens are encrypted at rest (AES-256-GCM)
- The PHP script (`backup-wp.php`) is protected by a unique token generated per run, only its hash is stored on the server
- The token is deleted from the server as soon as it's validated
- The PHP script self-deletes after execution
- The dump filename is unguessable and the dump is deleted from the server right after download
- MySQL password is passed through the environment, never on the command line
- Git commands run without a shell, the GitHub token is handed to git through the environment and never appears in URLs, in `.git/config` or in logs
- A safeguard automatically cleans up orphaned artifacts at the start of each run

## Incremental vs full mode

By default, backups run in **incremental** mode:
- Compares size and modification date of each remote file with the local file
- Only downloads new or modified files
- Deletes local files that no longer exist on the remote (skipped if part of the remote listing failed)
- FTP scanning uses a pool of 5 parallel connections for faster listing
- Skips what is regenerable or foreign to the site, without even listing it: archives left by backup plugins (UpdraftPlus, All-in-One WP Migration, Duplicator, BackWPup, WPvivid), page caches (WP Rocket, W3 Total Cache, LiteSpeed, Divi), update leftovers, `debug.log` and `error_log`. Excluded entries are named in the run log. A site-specific exclusion goes in the `.gitignore` of its repository.

The "Full download" option clears the local tree and downloads every file again. It refuses to run when part of the remote listing failed, so a partial snapshot never replaces a complete one.

## Multi-site support

Backups run through a queue with limited concurrency (configurable in Settings). Each site has its own log, stored with the run and streamed live in the UI. A site can't have two backups running at the same time. The History page filters by site and status; the site form has a "Test connection" button that lists the web root before saving.

Every enabled site is scheduled with node-cron, on its own cron expression or the global default (the 1st and the 15th at 02:00 by default), in the `TZ` timezone. Old runs are pruned daily once past the retention period; the last 5 of each site are always kept.

## Error handling

- A backup never crashes the app — every run ends with a status (`success`, `error`, `cancelled`) and its log
- SharePoint and release errors are non-blocking (backup is still considered successful)
- Git errors are reported, the backup is marked as error
- On dump failure, remote files (PHP, token) are cleaned up
- Runs interrupted by a restart are marked as error at next boot

## Debug

If something goes wrong with a site, delete `$DATA_DIR/files/your-site` and re-run the backup. It will clone the repo and do a full download.

To look at what the sync would do without touching the remote or the clone:

```bash
npx tsx scripts/smoke-sync.ts your-site.com   # scan + plan, read-only
```

## Deploy (Docker)

The image is built by GitHub Actions and published on GHCR as `ghcr.io/dewwwe-site-saves/reposite`: `staging` on every push to `main`, `latest` and `X.Y.Z` on version tags, `<branch>` when the workflow is run by hand. It runs as a Portainer stack from [docker-compose.yml](./docker-compose.yml): Stacks, Add stack, Repository, compose path `docker-compose.yml`, branch `main`. The stack's environment variables carry everything host-specific:

- `ENCRYPTION_KEY`, `SESSION_SECRET` — `openssl rand -hex 32` each
- `REPOSITE_DATA` — host directory mounted on `/data`
- `REPOSITE_SUBNET` — a free `/29` for the stack network
- `REPOSITE_PORT` — host port (default `3000`), `PUID` / `PGID` (default `1000`), `TZ`, `REPOSITE_TAG` (default `latest`)
- `APP_URL` — public URL of the instance, optional, for the links in notification mails

The container runs as `PUID:PGID`: the entrypoint makes the data directory theirs, applies the migrations and starts the server. Health is reported on `/api/health`. Updates are manual: Stack, Editor, Pull and redeploy. Put the app behind an HTTPS reverse proxy (an SSO gateway in front of it works, the app keeps its own login).

First run: open the app, create the admin on `/setup`, fill in Settings (commit author, GitHub token, SharePoint). To import the sites of a legacy `config.json`, copy it into the data volume, run the import in the container as the app user, then delete it (it holds cleartext passwords):

```bash
docker cp config.json Reposite-App:/data/config.json
docker exec -u 1000 Reposite-App npx tsx scripts/import-config.ts /data/config.json
docker exec Reposite-App rm /data/config.json
```

Lost password in Docker:

```bash
docker exec -u 1000 Reposite-App npx tsx scripts/reset-password.ts admin@example.com
```

Existing clones can be moved into `/data/files/<repo>` while the container is stopped: the entrypoint fixes their ownership at the next boot and the engine resets their remote URL at the next run.

Local build, to check the image before pushing:

```bash
docker build -t reposite:local .
docker run --rm -p 3000:3000 -v "$(mktemp -d):/data" -e ENCRYPTION_KEY=$(openssl rand -hex 32) -e SESSION_SECRET=$(openssl rand -hex 32) -e SESSION_COOKIE_SECURE=false reposite:local
```

## Versioning & Releases

Versions are git tags. Pushing an annotated `vX.Y.Z` tag makes GitHub Actions build the image with that version, tag it `latest`, and create a GitHub Release whose notes list the commits since the previous tag. A tag with a suffix (`v2.1.0-beta.1`) is a pre-release.

```bash
git tag -a v2.0.0 -m "Release v2.0.0"
git push origin v2.0.0
```

## Roadmap

What comes next, and the checks still pending on the production instance, live in [ROADMAP.md](./ROADMAP.md).
