# Reposite — project instructions

Self-hosted backup manager for WordPress sites: pulls files over FTP/SFTP, dumps the database, versions everything in a GitHub repo. Next.js web UI to manage sites, run backups, follow logs and schedule them.

## State

v2 is in production since 2026-09-06 (Docker image from GHCR, Portainer stack, behind an HTTPS reverse proxy with SSO in front). `main` is the only branch; features branch off it and merge back. [ROADMAP.md](./ROADMAP.md) lists the checks still pending on the production instance and what comes next: look there before proposing a feature, and move an item out of it when it ships.

## Engine

`lib/engine` is pure TypeScript: no Next.js import, no Prisma import, no ambient config. It only sees the decrypted `SiteConfig` / `GithubConfig` / `SharePointConfig` objects from `lib/engine/types.ts`.

- `backup.ts` — `runBackup(site, github, sharepoint, options)` is the single entry point. It never throws: the outcome is `result.status` (`success` | `error` | `cancelled`) plus `errorMessage` and the full log. The queue copies the result as-is.
- `git.ts` — `execFile` with array arguments, identity and credentials passed per invocation with `-c`. The token reaches git through an inline `credential.helper` reading `GIT_BACKUP_TOKEN` from the environment (no `GIT_ASKPASS` file), never through a URL. Errors are built from stderr only.
- `remote/` — `RemoteClient` interface, FTP (basic-ftp, 5 connections) and SFTP (ssh2-sftp-client, 3 connections, one worker per connection). Engine paths are absolute under the login directory (`/www/...`); the SFTP client resolves them under `realPath('.')` because an SSH login lands in a real home. The local tree keeps the web root folder (`www/...`). `connect.ts` — `openClient(factory, { log, signal })` opens one connection with two retries (5 s, 15 s): shared hosts drop a fresh login now and then. Every connection of a run goes through it, and the dump gets a fresh one when the leftovers cleanup failed, since that failure is usually a socket the host closed right after login.
- `sync.ts` — scan, plan, download, prune. `DEFAULT_EXCLUDES` (gitignore-like patterns relative to the web root: backup plugin archives, caches, update leftovers, logs) is applied at scan time, so an excluded directory is never listed and a local file under it is pruned as an orphan; `syncFiles` accepts another list through `options.excludes`. Only regenerable content belongs there, never uploads, plugins or themes. Orphan deletion is skipped when any directory failed to list; full mode refuses a partial listing. The remote artifact names (`dewwwe-backup.php`, `.dewwwe-backup-token`) are constants there and are excluded from the scan; the cleanup step at the start of each run looks for them, so renaming them is a roadmap item, not a quick edit.
- `dump.ts` — token hash + `helpers/backup-wp.php` uploaded from memory, HTTPS trigger with `redirect: 'manual'`, dump downloaded to `<clone>/db.sql` and validated, remote artifacts removed in `finally`.
- `sharepoint.ts` — PnP v4, `SPDefault()` + `MSAL()` behaviors, certificate under `DATA_DIR/sp-certificates/key.pem`. Failure is a warning.
- Cancellation: check `options.signal` between steps and files with `throwIfAborted`, wrap long calls with `abortable`, detect with `isCancellation` (`lib/engine/cancel.ts`).
- Tests use `lib/engine/testing/fake-remote.ts` (in-memory `RemoteClient`), a real git binary on temp bare repos (with `GIT_CONFIG_GLOBAL=/dev/null`) and `vi.stubGlobal('fetch', ...)`. `scripts/smoke-sync.ts` runs a read-only scan and plan against a real site from the local database, for debugging the sync without a full run.

## Layout

- `app/` — Next.js 16 App Router. `app/(app)/` holds the pages behind the login (its layout loads the current user and renders `AppShell`), `app/(auth)/` the login and setup pages, `app/api/` the route handlers (table below).
- `proxy.ts` — Next 16 proxy (the former middleware): verifies the session cookie on every request except `/login`, `/setup`, `/api/auth/{login,setup,logout}` and `/api/health` (the Docker probe); pages are redirected to `/login?next=`, `/api/*` gets a 401. No database access there: the login page redirects to `/setup` while the `User` table is empty, and `/setup` back to `/login` once a user exists.
- `components/` — React components, `components/ui` is shadcn. `JobStatusProvider` is the single poller of `/api/status` (3 s, paused when the tab is hidden); components read it through `useJobStatus()` and it calls `router.refresh()` whenever the set of active backups changes, so server components never poll themselves.
- `lib/` — `db.ts`, `prisma.ts`, `crypto.ts`, `validation.ts` (zod), `constants.ts` (statuses, protocols, `SECRET_MASK`: the only lib module client components may value-import, `validation.ts` pulls node-cron), `paths.ts`, `auth.ts` (bcrypt, JWT session token, cookie options; no database import so the proxy can use it), `session.ts` (`getCurrentUser`, `requireRole`, `openSession` / `closeSession` through `next/headers`), `login-throttle.ts` (5 failures per address, 15 min lockout, 429 with `Retry-After`), `api.ts` (`jsonError`, `parseBody`, `apiHandler`), `connection-test.ts`, `env.ts` (`appUrl()` from `APP_URL`, null when unset)
- `lib/notifications/` — `mailer.ts` (nodemailer over SMTP, pure: takes a decrypted `MailConfig`, one transport per send), `templates.ts` (failure, interrupted-by-restart and test mails as text + HTML, no I/O), `notifier.ts` (`start()` subscribes once to the queue's `done` event and mails every `error` outcome when `Settings.notifyOnError` is on and the SMTP block is complete; `notifyInterrupted` for the boot sweep). A mail that cannot be sent is logged to the console and dropped, never surfaced to the run. `getMailConfig` / `toMailConfig` in `lib/db.ts` build the config, the password decrypted separately so the SMTP test can use the typed one.
- `lib/jobs/` — `queue.ts`: DB-first queue. The `Backup` row is the job; in memory only the `AbortController` and the log buffer of the runs in progress. `enqueue` throws `BackupConflictError` when the site already has an active backup, `cancel` marks a pending row or aborts a running one, `subscribe(backupId, listeners)` registers `log` / `status` / `done` listeners and returns the buffered lines in the same tick (the SSE route relies on that ordering). Queue, scheduler and boot state live on `globalThis` unconditionally: in production the boot hook and the route bundles may not share a module instance. `scheduler.ts`: one node-cron task per enabled site, `reload()` rebuilds them from the database and must be called after every site or settings mutation. `boot.ts`: called once by `instrumentation.ts` (env check, `initDatabase`, orphan job sweep with a notification mail listing the swept sites, notifier, scheduler, daily retention).
- `lib/testing/db.ts` — throwaway SQLite database for tests that run Prisma for real (temp `DATA_DIR`, migrations replayed); import it before anything that touches the database.
- `lib/engine/` — the backup engine, see above
- `prisma/` — schema and migrations
- `helpers/backup-wp.php` — dropped on the remote host to dump the database, read at each run from `<cwd>/helpers`
- `scripts/` — `tsx` scripts: `import-config.ts` (legacy v1 config.json), `reset-password.ts <email> [password]` (the only way back in without the current password), `smoke-sync.ts <domain>` (read-only sync debug). In Docker they run through `docker exec -u <PUID> Reposite-App npx tsx scripts/...`, which is why `tsx`, `scripts/` and `lib/` ship in the image.
- `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.yml`, `.dockerignore` — the image and the Portainer stack, see below. `.github/workflows/` — `ci.yml` (typecheck, format check, tests on every push), `docker-build-push.yml` (image on GHCR), `release.yml` (GitHub Release on a `v*` tag).

### API

| Method | Route | Notes |
|--------|-------|-------|
| POST | `/api/auth/setup` | creates the first admin, 403 once a user exists |
| POST | `/api/auth/login` | `{ email, password }` → session cookie, throttled per address |
| POST | `/api/auth/logout` | |
| PUT | `/api/auth/password` | `{ currentPassword, newPassword, passwordConfirmation }` for the current user |
| GET / POST | `/api/sites` | list (no secrets) / create |
| GET / PUT / DELETE | `/api/sites/[id]` | detail without secrets; PUT keeps the password when the field is empty or masked |
| POST | `/api/sites/test` | connection fields of the create form (password required), returns `{ ok, entries, error }` |
| POST | `/api/sites/[id]/test` | same body from the edit form; the stored password is used only when protocol, host, port and username match the stored row |
| GET | `/api/backups` | paginated, `?siteId=&status=&page=&pageSize=`, rows without the log |
| POST | `/api/backups` | `{ siteIds?, fullDownload?, skipGit? }`; omitted `siteIds` = all enabled sites; 201 `{ queued, conflicts }`, 409 when every site already had an active backup |
| GET | `/api/backups/[id]` | detail including the log |
| POST | `/api/backups/[id]/cancel` | |
| GET | `/api/backups/[id]/stream` | SSE: buffered lines then live ones, `: ping` every 25 s, `done` event carries the final status |
| GET | `/api/status` | `{ running: [...], pending: [...] }` |
| GET / PUT | `/api/settings` | the GitHub token and the SMTP password come back as `SECRET_MASK` when stored; PUT treats the mask or an empty string as "keep"; `notifyOnError: true` is refused (400) unless host, sender and recipients are set |
| POST | `/api/settings/test-github` | checks the typed (or stored) token against `GET /user`, then the push access to every site's repository |
| POST | `/api/settings/test-smtp` | sends a test mail with the typed SMTP block (stored password when masked), returns `{ ok, accepted, rejected, response, error }`: `ok` means every recipient was accepted by the server, `response` is its final line (queue id) for tracing on the server side |
| GET | `/api/health` | public, 200 when the database answers, 503 otherwise |

## Docker

Two stages on a pinned Alpine tag (`ARG NODE_IMAGE`, bump it explicitly, never a moving tag): `builder` (`npm ci`, `next build` standalone, then `npm prune --omit=dev` in place; no `--max-old-space-size`, Next strips it from its build worker) and `runner` (git, dumb-init, su-exec). One build stage on purpose: a separate `prod-deps` stage runs in parallel with the build under BuildKit and doubles the peak memory. The runner copies the standalone output, then the full production `node_modules` on top of it, then `prisma/`, `helpers/`, `scripts/`, `lib/` and the generated client: `prisma` and `tsx` are runtime dependencies on purpose so that `prisma migrate deploy` and the operator scripts run in the container.

The entrypoint runs as root only to map PUID/PGID, give `/data` to that user (top-level entries, plus a recursive pass on any clone under `files/` owned by someone else) and apply the migrations, then drops to the app user for `node server.js`. `DATA_DIR=/data`, `PORT=3000`, `/api/health` answers the `HEALTHCHECK`.

The image is built by GitHub Actions, never on the host: `staging` on `main`, `latest` and the semver tag on `vX.Y.Z`, `<branch>` on a manual run. Deployment is a Portainer stack in Repository mode on `docker-compose.yml`, updated by hand with Pull and redeploy. Everything host-specific (secrets, data path, subnet, port) comes from the stack environment: the compose in the repo must stay free of any real value.

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run format      # prettier --write .
```

Run `typecheck` and `test` yourself after changing engine or lib code. Anything with a side effect — `build`, `dev`, `db:migrate`, `db:deploy`, `npm install`, `docker build`, `docker run` — propose the command, don't run it.

There is no ESLint here on purpose: `eslint-config-next` pulls in typescript-eslint, which refuses to load under TypeScript 7 ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)) — the guard is in `@typescript-eslint/parser` too, so no TS parser is available at all. Prettier handles formatting and `tsc --strict` covers most of what the rules would catch. Don't re-add ESLint until that issue lands.

VS Code uses its bundled TypeScript for IntelliSense: TypeScript 7 ships no `tsserver.js`, so `js/ts.tsdk.path` must stay unset in `.vscode/settings.json`. `npm run typecheck` is the reference.

Spell checking: Code Spell Checker reads `.vscode/cspell.json`. Add project vocabulary there rather than sprinkling `cspell:ignore` comments.

## Conventions

- 4-space indent, single quotes, semicolons, `printWidth` 100 — Prettier enforces it, run `npm run format` before proposing a commit.
- Never hard-wrap prose at a fixed width, in markdown or in comments. One paragraph is one line.
- Code, identifiers, comments and **UI labels** in English.
- Imports use the `@/*` alias in `app/`, `components/` and root files (`importModuleSpecifier: non-relative`). Inside `lib/` they are relative: vitest resolves no alias, and `lib` must stay runnable from the tests.
- Dates stored as ISO 8601 UTC. Git tags are `YYYYMMDD-HHmmss` in UTC.
- Stored credentials are encrypted as `enc:v1:<iv>:<tag>:<data>` via `lib/crypto.ts` — never write a secret to the database in clear. The API never returns a stored secret: it sends `SECRET_MASK` (`lib/constants.ts`) and treats the mask or an empty string in a PUT as "keep the stored value".
- Route handlers are `export const GET = apiHandler(async (request, { params }) => ...)`: `AuthError` becomes its status, any other exception a 500 with a generic message. Mutating handlers start with `await requireRole('admin')`; read handlers rely on the proxy. Bodies go through `parseBody(request, schema)`, ids through `parseId`.
- Adding a page under `app/(app)/` needs nothing for auth; a new public route must be added to `PUBLIC_PATHS` in `proxy.ts`.
- A page or GET route that reads the database exports `dynamic = 'force-dynamic'`, even when it also reads cookies or search params: `next build` prerenders anything it can, and it does so against an empty database.
- All runtime state lives under `DATA_DIR` (env var, falls back to `cwd/data`): database, `files/<repo>` clones, `sp-certificates/`. Never build paths from `__dirname` — it breaks the Docker standalone build.
- The build-time tracer of `next build` (Turbopack) reads `path.join(process.cwd(), 'x')` as a reference to `x` and `path.join(anything, 'name')` as a `**/name` glob over the project, and copies the matches into the standalone output. The path helpers in `lib/paths.ts` and the `.git` join in `lib/engine/git.ts` carry `/*turbopackIgnore: true*/` for that reason, `next.config.js` excludes `data/` from the trace as a safety net, and a build that prints "matches N files" or "tracing of the whole project" is a bug to fix, not a warning to ignore: it once pulled the 100k files of the site clones under `data/` into the build. With the comments in place a build with the clones in the tree takes a few seconds and peaks under 1 GB.
- Schema changes go through `prisma migrate dev` locally (a versioned migration under `prisma/migrations`); the container applies them with `prisma migrate deploy` at boot. Never edit a migration that has shipped.
- Tests are vitest, colocated as `*.test.ts` next to the module.

## Public repository

The repository is public. Nothing in the tracked files may name a client, a real host, a private network, an internal document or a person: examples use `example.com`, `site.test`, placeholder subnets and generic names. Anything host-specific goes in the Portainer stack environment or in `.env`, never in a tracked file. Keep that in mind in docs and comments as much as in code.

## Do not touch

`.env`, `data/` and the legacy `config.json` hold live secrets and the real backups. They are gitignored and denied in `.claude/settings.json`.

## Working style

- Prefer a few well-scoped commits over one big one, and a pure-rename commit before rewriting a file so `git log --follow` keeps its history. Run `/code-review` before the final commit.
- Never commit or push — propose the message and the `git add` command, the maintainer commits.
- Don't add a dependency without asking first. Moving `prisma` or `tsx` back to `devDependencies` breaks the image.
- End every session by bringing the docs back in line with what was actually done: this file (state, engine notes, API table, conventions), `README.md` (how it works, deploy) and `ROADMAP.md` (pending checks, next features). Stale knowledge is worse than none.
