# Roadmap

v2 is in production since 2026-09-06. This file tracks what is left to verify on the running instance and what comes next. Items move from "Ideas" to "Next" when they get a design, and out of this file when they ship (the README keeps the list of what the app does).

## Checks pending on the production instance

Everything below is code that exists and is covered by tests, but has not yet been exercised end to end on the deployed instance.

- [ ] One backup per remaining site (each site once, so that protocol, web root and dump path are confirmed for all of them; the first site passed on 2026-09-06)
- [ ] A scheduled run firing on its own at the configured time
- [ ] A run with nothing changed on the remote: no commit, no tag, no Release, status `success`
- [ ] Login throttle: 429 with `Retry-After` after five failed attempts from the same address
- [ ] A backup cancelled from the UI while a download is in progress leaves the clone consistent (next run recovers)
- [ ] A container restart during a run: the next scheduled run goes through after the sweep (the sweep itself passed locally on 2026-09-06: the backup was marked `error` "Interrupted by server restart" and the "interrupted" mail arrived)
- [ ] Notifications, test mail: "Send test mail" shows the server's response line and the message reaches every recipient (delivery confirmed locally on 2026-09-06, the first missing mails were an SMTP misconfiguration on the sending side, not the app)
- [ ] Notifications, failure mail: a real failed run (wrong FTP password on a test site) produces the mail with the error, the log tail and the history link (`APP_URL` set in the stack environment)
- [ ] Notifications, partial refusal: a bogus recipient next to a valid one shows as refused in the test result and as a warning in the container log
- [ ] Notifications, switch: saving with "Errors" on and an incomplete SMTP block is refused with the field named; with the switch off nothing is sent on a failed run
- [ ] Notifications, password manager: typing the SMTP password and sending a test mail no longer triggers the "save password" prompt (opt-out attributes for 1Password, LastPass, Bitwarden, Dashlane; Chrome's built-in manager has no opt-out)

## Next

Features with a rough design, in the order they are likely to be built.

- [ ] **Hack detection**. PHP in `wp-content/uploads`, suspicious patterns, core checksum verification via `api.wordpress.org`. Adds `hackAlert` / `hackDetails` columns by migration. Alerts go out through the notification mails, as a second switch next to "Errors".
- [ ] **Multi-user and audit log**. Two halves of one feature: identity per person, then a trace of who did what. Identity comes from the SSO gateway in front of the app (Authelia forward-auth headers `Remote-User` / `Remote-Email` / `Remote-Groups`): the user row is created on first visit, the role derived from the group, the mode enabled explicitly by an env var and the headers trusted only behind a shared secret set by the reverse proxy, since the container port is reachable from the LAN. No OIDC client, no new dependency. The audit log is an `AuditEvent` table written from every mutating handler and from the queue (who queued or cancelled a backup), with a page in Settings. `viewer` role enforced through `requireRole`.
- [ ] **Size report before the push**. The ten largest files of the run's delta in the log, and a warning for any file over 100 MB since GitHub refuses it (a 211 MB UpdraftPlus archive took a whole push down with an HTTP 408 on 2026-09-15, before the default exclusions existed). Makes the exclusion list self-correcting: what should not be there shows up in the report.
- [ ] **Per-site exclusions**. A `Site.excludes` text field edited in the site form, appended to the default list (`DEFAULT_EXCLUDES` in `lib/engine/sync.ts`); `syncFiles` already takes the list as an option. Candidates seen on real sites: `wp-content/uploads/elementor/css/` (regenerated CSS), `wp-content/uploads/wc-logs/`.
- [ ] **Retry on transient remote errors**. FTP hosts sometimes answer "temporarily unavailable" for a few seconds and the run fails on the first such error (issue #5). Retry a listing or a download a few times with a delay before giving up, and count the retries in the run stats.
- [ ] **Design pass on the UI**. Phone layout, spacing and typography, empty states, the live log modal on small screens. Done as one dedicated pass rather than page by page.
- [ ] **Repo history retention**. Keep the last N Releases per site and drop older snapshots. Deleting tags and Releases alone does not free space on GitHub; reclaiming it means re-rooting the branch (new orphan commit from the current tree, force push, GitHub runs gc later). Needs a setting per site and a dry-run report before the first real run.
- [ ] **Restore**. Pick a Release or tag, upload files over FTP/SFTP, `restore-db.php` with the same token scheme, automatic pre-restore backup.
- [ ] **Hardening headers and origin checks**. CSP, `X-Frame-Options`, `poweredByHeader: false` in `next.config.js`. `APP_URL` (already read by `lib/env.ts` for the mails) becomes the trusted origin: mutating API requests must carry a matching `Origin` (CSRF), the `next=` parameter of the login page is only followed when it stays on that origin, and the cookie `Secure` flag can be derived from its scheme instead of `SESSION_COOKIE_SECURE`.

## Ideas

Not designed yet, kept so they are not forgotten.

- [ ] **More notification channels and events**: success digest (daily or per run), Discord and Slack webhooks, per-site recipients. Each event is one more switch in the Notifications block of Settings.
- [ ] **Per-site commit identity**: optional `Site.commitName` / `Site.commitEmail` overriding the global identity from Settings, for a client repo that must show the client's own author. Site form gets an "Override commit author" toggle; `lib/db.ts` merges site, then settings, then default when building the `GithubConfig`.
- [ ] **Repo auto-creation** from the site form through the GitHub API (private repo, README).
- [ ] **API tokens** for external triggers (webhooks, curl) without a browser session.
- [ ] **SSH remotes** as an alternative to the HTTPS token (app-generated key shown in Settings).
- [ ] **Restic backend** instead of git (deduplication, encryption, retention).
- [ ] **WP-CLI dump** for sites with SSH access (`wp db export`).
- [ ] **Prestashop / Drupal** dump scripts.
- [ ] **Multi-arch image** (`linux/arm64`) if the host ever changes.
- [ ] **Diff viewer** between two backups, size tracking and storage alerts.
- [ ] **File explorer**: browse the tree of a given backup (Release or tag) from the UI, view or download a single file, entry point for a per-file restore. Read from the local clone via `git ls-tree` / `git show`, no extra storage.
- [ ] **Structured logs**: log lines carry a level and a step (scan, download, dump, commit, push, sharepoint); the live log modal and the backup detail page get level filters and a per-step timeline with durations.
- [ ] **Backup integrity verification**: checksum of each downloaded file against the remote when the protocol allows it.
- [ ] **Integration tests** against a local FTP/SFTP container.
- [ ] **Rename the remote artifacts** (`dewwwe-backup.php`, `.dewwwe-backup-token`) to a product name. Only once no host carries leftovers under the old names, since the cleanup step at the start of each run looks for them.
