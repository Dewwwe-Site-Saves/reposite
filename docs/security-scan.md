# Security: hack detection

Design document for the security scan feature, written before the first line of code and kept in step with what ships. Each phase below is one commit that leaves the app deployable; when a phase lands, its section stays as the reference for how the feature works and the ROADMAP loses the corresponding item.

## Context

Reposite mirrors every site into a local git clone (`<DATA_DIR>/files/<repo>/www` plus `db.sql`), one tag per run. That mirror is the input of the new feature: a scanner that reads a local directory and a dump, never the remote, and reports findings. It runs as a step of every backup (after the sync, before the commit), as a standalone "scan only" run on a site's clone, and later on any folder dropped under a scan directory. Findings carry a fingerprint so that repeated findings are recognised, false positives are silenced through ignore rules created from the UI, and the notification mail only lists what is new.

Decisions taken with the maintainer (2026-09-06):

- Scanner = pure engine module under `lib/engine/scan/`, input is a local root. Rules live in code, versioned and tested; the configuration is ignore rules.
- Job model = "run with steps": `Backup` gains `skipDump`, `skipSync`, `skipScan` next to `skipGit`. A scan-only run is a run with only the scan step. Same queue, log stream, cancel and boot sweep.
- Persistence = `Scan`, `Finding`, `ScanIgnore` tables, not columns on `Backup`.
- Rule families for v1: files and patterns, changes since the last snapshot, database dump. Core checksums via `api.wordpress.org` deferred (ROADMAP). No `fullScan` flag: the file family always walks the full tree and nothing would read it.
- Custom folder scans read a relative path under `SCAN_DIR` (default `<DATA_DIR>/scan`: the operator drops folders into the existing data volume, no compose change). Upload deferred.
- The scan verdict never changes a backup's status: an infected site is still backed up. A scan-only run fails only when the scanner itself fails.
- Two engine entry points: `runBackup` keeps its `SiteConfig` contract, `runFolderScan` handles folders. Both call the same `scanStep`.
- Five commits, each leaving the app deployable: typecheck and tests green, the default backup flow unchanged, each migration additive and applicable on the production database, and a concrete verification per phase. The `Backup` table rebuild (nullable `siteId`) is isolated in phase 5.

## Data model (final state)

```prisma
model Backup {
  site      Site?   @relation(fields: [siteId], references: [id], onDelete: Cascade)
  siteId    Int?                       // phase 5: null for a folder scan
  scanPath  String?                    // phase 5: relative to SCAN_DIR
  skipDump  Boolean @default(false)    // phase 2
  skipSync  Boolean @default(false)    // phase 2
  skipScan  Boolean @default(false)    // phase 2
  scan      Scan?
  // existing fields unchanged
  @@index([scanPath])                  // phase 5
}

model Scan {
  id            Int      @id @default(autoincrement())
  backup        Backup   @relation(fields: [backupId], references: [id], onDelete: Cascade)
  backupId      Int      @unique
  site          Site?    @relation(fields: [siteId], references: [id], onDelete: Cascade)
  siteId        Int?
  scanPath      String?                // phase 5
  startedAt     DateTime
  finishedAt    DateTime
  rulesVersion  Int
  filesScanned  Int
  criticalCount Int                    // non-ignored findings per severity
  warningCount  Int
  infoCount     Int
  newCount      Int                    // non-ignored findings with isNew
  errorMessage  String?                // a family that could not run; the scan still happened
  findings      Finding[]
  @@index([siteId, startedAt(sort: Desc)])
  @@index([scanPath, startedAt(sort: Desc)])   // phase 5
}

model Finding {
  id          Int     @id @default(autoincrement())
  scan        Scan    @relation(fields: [scanId], references: [id], onDelete: Cascade)
  scanId      Int
  ruleId      String
  severity    String  // critical | warning | info
  path        String  // POSIX, relative to the scan root; a table name for database findings
  line        Int?
  excerpt     String  // one trimmed line, max 200 chars, never rendered as HTML
  fingerprint String  // sha256(ruleId \0 path \0 normalized evidence), 32 hex chars
  isNew       Boolean
  ignored     Boolean @default(false)
  @@index([scanId, severity])
  @@index([fingerprint])
}

model ScanIgnore {
  id          Int      @id @default(autoincrement())
  site        Site?    @relation(fields: [siteId], references: [id], onDelete: Cascade)
  siteId      Int?     // null = global
  ruleId      String?
  pathGlob    String?  // *, **, ? only
  fingerprint String?
  reason      String?
  createdAt   DateTime @default(now())
  @@index([siteId])
}

model Settings {
  scanOnBackup     Boolean @default(true)   // phase 2: default for skipScan when enqueue is not told
  notifyOnFindings Boolean @default(false)  // phase 4
}
```

Semantics:

- An ignore matches when every field it sets matches (AND); an unset field matches anything; a rule with no field set matches nothing (the API refuses it).
- Ignored findings are stored with `ignored = true`, never dropped: dropping them would make their fingerprints absent from the previous scan and they would come back as new, firing the mail. Counts exclude them. Creating an ignore flips matching open findings of the latest scans; deleting one takes effect at the next scan (UI copy says so).
- `isNew` is computed at persistence: fingerprints of the previous `Scan` of the same `siteId` (or `scanPath`) form the baseline; absent = new. First scan: everything is new.
- No `Scan` row for a cancelled run.

## Phase 1: engine module, rules, smoke script

Commit `scan: engine module with file, change and database rules`. No schema, no app wiring: only `scripts/smoke-scan.ts` reaches the scanner.

Layout (relative imports inside `lib/`, tests colocated):

```
lib/engine/scan/
  index.ts        scanTree(input): Promise<ScanReport>
  types.ts        Severity, FileMeta, RuleFinding, Finding, ChangedFiles, rule interfaces, ScanInput, ScanReport
  registry.ts     RULES, RULES_VERSION = 1
  walk.ts         walkTree(): async generator over fs.promises.opendir, symlinks counted and never followed
  fingerprint.ts  normalizeEvidence(), fingerprint(ruleId, path, evidence)
  ignore.ts       IgnoreRule, compileIgnores(), isIgnored(), globToRegExp()
  webroot.ts      detectWebRoot(root): '' | 'www' | ... | null
  rules/          uploads-php.ts, php-patterns.ts, htaccess.ts, fake-extension.ts, unexpected-core.ts, changes.ts
  db/             sql-stream.ts (readDump, parseValues, parseColumns), rules.ts
```

Rule interfaces, all with `id`, `severity`, `title` (short, shown as the section heading in the report, e.g. "PHP file in uploads"), `description` (what the vulnerability is) and `remediation` (what to do), plus one of:

- `PathRule.check(file, ctx)`: decides on the path alone, never reads.
- `ContentRule.wants(file)`, `readBytes?`, `check(file, content, ctx)`: the runner reads a file once, with the max `readBytes` of the rules that want it, capped at `MAX_FILE_BYTES = 2 MB`, and runs all of them on the same string.
- `ChangeRule.check(changes, ctx)`: skipped entirely when `input.changedFiles` is undefined.
- `DatabaseRule.tables`, `row(table, row, ctx)`, `finish?(ctx)`: fed while `db.sql` streams, only when `<root>/db.sql` exists (`DUMP_FILE_NAME` from `lib/engine/dump.ts`).

`RuleContext` carries `root`, `webRoot` (relative prefix, `''` when the root is the web root), `domain | null`, and `tree: ReadonlySet<string>` of every path relative to the web root for tree-shaped checks. `DatabaseContext` adds the detected table `prefix`.

`scanTree` order: detect web root, one walk running path rules and content rules per file, change rules, database rules, then fingerprint, apply ignores, cap at `MAX_FINDINGS = 2000`, sort by severity then path. `throwIfAborted` (`lib/engine/cancel.ts`) between directories and families. Progress log every 2000 files. A rule that throws is skipped with an entry in `report.errors`; the scan never throws except on cancellation. `ScanReport` = `{ rulesVersion, filesScanned, filesRead, findings, warnings, errors, durationMs }`.

Rules v1, severity discipline is the false-positive defence: a lone generic pattern is warning, critical is reserved for combinations, PHP under uploads, or a PHP tag in an image.

- `uploads.php-file` critical: `.php .phtml .php3-8 .phps .pht .inc` under `wp-content/uploads/` (path rule).
- `php.*` (one content rule over PHP, one pass over lines, a table of `{ id, re, severity }`): warning for `eval(`, `base64_decode(`, `gzinflate(`, `gzuncompress(`, `str_rot13(`, `create_function(`, `assert(` with a string, `preg_replace` with `/e`, `error_reporting(0)`; critical for `base64_decode` and `eval` on the same line, `$_POST|$_GET|$_REQUEST|$_COOKIE` reaching `exec|system|passthru|shell_exec|popen|proc_open` on the same line, a base64 literal of 200+ chars, 20+ `\x` escapes in one string. Regexes anchored and quantifier-flat.
- `htaccess.auto-prepend` critical, `htaccess.handler` critical (non-PHP extension made executable), `htaccess.external-rewrite` warning.
- `file.php-in-image` critical: `<?php` or `<?=` in the first 256 bytes of `.ico .png .jpg .jpeg .gif .txt .svg .css .js` under uploads (`readBytes: 256`).
- `core.unexpected-root-php` warning (PHP at the web root outside the known WordPress set), `core.random-name` warning (generated-looking basename under `wp-admin/` or `wp-includes/`).
- `change.new-uploads-php` critical, `change.new-root-php` warning, `change.core-modified` warning (documented as warning until core checksums exist), `change.new-in-wp-includes` warning.
- `db.siteurl-mismatch` critical (host not the domain nor a subdomain, skipped without domain), `db.admin-account` info escalated to warning when registered within 30 days or the login looks generated (users and usermeta accumulated, resolved in `finish`), `db.post-content-injection` warning, `db.option-base64` warning (`active_plugins`, `widget_*`, `cron`), `db.missing-plugin-dir` warning (serialized `s:n:"..."` literals pulled by regex, no unserializer).

`db/sql-stream.ts`: target confirmed from `helpers/backup-wp.php` (plain `mysqldump --single-transaction --quick`): extended inserts, `\'` escaping, no `--hex-blob`, columns from `CREATE TABLE`. `createReadStream` + `readline` with `crlfDelay: Infinity`, lines accumulated until a `;` outside a string literal with quote state tracked across lines, value scanner handling `\\ \' \" \n \r \t \0 \Z`, `''`, `NULL`, numbers and `_binary`. Prefix from the first `CREATE TABLE \`(\w+?)options\``, fallback `wp_` with a warning. `MAX_STATEMENT_BYTES = 64 MB`: warn and skip, never OOM. Read as utf8, only ASCII markers matched.

`scripts/smoke-scan.ts <dir> [--domain site.test] [--rule id] [--json]`: same shape as `smoke-sync.ts`, no database access, prints counts, `filesScanned` / `filesRead` / duration, then the findings.

Also: `.vscode/cspell.json` vocabulary; CLAUDE.md engine section and scripts line; ROADMAP "Hack detection" rewritten with the phased design and what is deferred.

Tests: one positive and one negative case per rule on temp fixture trees, `sql-stream.test.ts` (extended inserts, `;` inside a value, escaped quotes, NULL, multi-line statement, oversized statement), `ignore.test.ts` (glob, AND semantics, empty rule matches nothing), `fingerprint.test.ts` (stable across reindent and line shift), a bounded-time test on a 1 MB minified single line.

Verify: `npm run typecheck`, `npm test`. Then `npx tsx scripts/smoke-scan.ts data/files/<repo> --domain <domain>` on a real clone: expect zero critical on a clean site, note `filesRead` and duration. Plant `<?php eval(base64_decode($_POST[0]));` under `wp-content/uploads/x.php` in a scratch copy and confirm `uploads.php-file` and the `php.*` critical. No app file is touched.

## Phase 2: schema, run flags, scan step, persistence

Commit `scan: run step flags, scan tables and the scan step after the sync`.

Migration `prisma/migrations/<ts>_scan/` generated with `prisma migrate dev` then renamed to the hand-named convention: `ALTER TABLE ADD COLUMN` for `Backup.skipDump/skipSync/skipScan` and `Settings.scanOnBackup`, `CREATE TABLE` for `Scan`, `Finding`, `ScanIgnore` (without `scanPath`), indexes. Purely additive, no rebuild. No `;` inside literals: `lib/testing/db.ts` replays migrations by splitting on `;`.

`lib/engine/git.ts`, three helpers sharing one `--name-status -z` parser (in `-z`, `R*` and `C*` entries carry two paths: a rename counts as delete plus add, that is the test to write):

- `changedFiles(ctx, from, to)`: between two refs.
- `stagedChanges(ctx)`: `git add --all` then `diff --cached --name-status -z HEAD`. Untracked files are invisible to a plain diff, hence the staging, idempotent with the `add --all` in `commitAndTag`. Returns null on an unborn branch (fresh clone), the family is then skipped with a warning rather than reporting the whole tree as added.
- `lastTags(ctx)`: the two most recent from `git tag --sort=-refname`, null when fewer than two (tags are `YYYYMMDD-HHmmss`, refname order is chronological).

`lib/engine/scan/step.ts`: `scanStep({ root, domain, webRoot?, changedFiles?, ignores, log, signal })` runs `scanTree` and logs one verdict line (`Scan complete: 2 critical, 5 warning, 1 info (3 new), 41302 files`). Throws on cancellation and on scanner failure; the caller decides.

`lib/engine/backup.ts`, one function, one try/catch, each step under its flag:

| Step | Guard |
|---|---|
| `ensureRepo` + `prepareLocalTree` | always |
| leftovers + `dumpDatabase` (one connection) | `!skipDump` |
| `syncFiles` | `!skipSync` |
| scan (new, between sync and commit) | `!skipScan` |
| commit, push, Release | `!skipGit` |
| SharePoint | `status === 'success' && !skipDump && !skipSync`: a scan-only run must not stamp the tracking list |

Scan block: `changes = skipSync ? lastTags → changedFiles : stagedChanges`, then `scanStep`. Failure is `log.warn('Security scan failed: ...')` and `scan = null`, status untouched, same shape as `publishRelease`; cancellation rethrown. Ordering constraint: after the staging, before `commitAndTag`. `BackupOptions` gains the three flags and `ignores?`; `BackupResult` gains `scan: ScanReport | null`.

`lib/db.ts`: `listScanIgnores(siteId | null)` (global plus site), `saveScan({ backupId, siteId, report, startedAt, finishedAt })` (two reads for the baseline, counts in JS excluding ignored, one nested `prisma.scan.create` with `findings: { createMany }`, no interactive transaction on the single-connection adapter), `getLastScan(siteId)`.

`lib/jobs/queue.ts`: `EnqueueOptions` gains the three optional flags; `insertPending` resolves `skipScan ?? !settings.scanOnBackup` inside the lock; `PendingRow` and the select gain the flags; `run` loads the ignores next to the configs, passes the flags, and calls `saveScan` after the `backup.updateMany` so a `saveScan` failure (caught, logged) cannot lose the run result.

API and UI, enough to observe the phase: `runBackupSchema` and `settingsSchema` accept the flags and `scanOnBackup`; `POST /api/backups` forwards them; `GET /api/backups/[id]` includes the scan counts; the run dialog (`RunContent` in `LogModal.tsx`) gains the three switches next to the existing two; the Settings page gains a "Security" block with the "Scan on backup" switch; `lib/format.ts` option labels.

Tests: `git.test.ts` (rename, untracked staged, unborn branch, `lastTags`); `backup.test.ts` (each flag; a planted `www/wp-content/uploads/shell.php` in the fake remote gives a critical in `result.scan`; a throwing rule leaves `success`; scan-only makes no remote call); `db.test.ts` for `saveScan` (`isNew` false on an identical second run, true for a new fingerprint, ignored flagged, counts); `queue.test.ts` (`skipScan` default from the setting, override, cancel writes no Scan).

Verify: migration applied on a copy of the production database (propose the commands, `prisma migrate deploy`), every `Backup` row survives with the flags at false. With "Scan on backup" off, a run is byte for byte the previous code path. With it on, one extra log line and one `Scan` row. From the run dialog: a backup with the scan, then a scan-only run (fast, no FTP, no push). Insert a `ScanIgnore` row by hand, rerun scan-only, the finding comes back `ignored = 1` and the counts drop.

Docs: CLAUDE.md (engine, queue, API table, settings), README (what a run does), ROADMAP.

## Phase 3: API, Security page, badges, history filter

Commit `security: findings page, ignore rules, scan summary in history`.

API (house pattern: `apiHandler`, `dynamic = 'force-dynamic'`, `requireRole('admin')` on mutations, `parseBody`, `parseId`):

| Method | Route | Notes |
|---|---|---|
| GET | `/api/scans` | `?siteId=&page=&pageSize=`, no findings |
| GET | `/api/scans/[id]` | scan with findings, `?includeIgnored=1` |
| GET / POST | `/api/scan-ignores` | `scanIgnoreCreateSchema` with a `superRefine` requiring at least one of `ruleId` / `pathGlob` / `fingerprint`; POST also runs `markIgnored` on the latest scans |
| DELETE | `/api/scan-ignores/[id]` | next scan surfaces the findings again |
| GET | `/api/backups` | `?kind=backup|scan` |

`lib/db.ts`: `getSecurityOverview()` (latest scan per site with counts and `newCount`, plus the cross-site rule table: per `ruleId`, sites and files affected, from the latest scan of each site, non-ignored), `getSiteScanReport(siteId, scanId?)` (a scan with its findings, default the latest), `listScans(siteId)` (history with counts), `createScanIgnore` + `markIgnored` (compiled with `compileIgnores`), `deleteScanIgnore`. `lib/format.ts`: `runKind(row)` = scan when `skipDump && skipSync`, mirrored once in the `listBackups` where clause. Rule metadata (`title`, `description`, `remediation`, `severity`) is exposed to the UI through a `RULE_CATALOG` in `lib/constants.ts` derived from the registry at build time of the module (client components value-import `constants.ts` only).

Findings are never shown as a flat log. Three levels, labels in English:

- **Overview**, `app/(app)/security/page.tsx` (`force-dynamic`), "Security" entry in `components/Sidebar.tsx` between History and Settings. One card per site: verdict (clean, findings, never scanned), counts by severity, "N new", last scan date, "Scan now" (enqueue scan-only, then `LogModal` live), link to the report. Below, "By vulnerability": one row per rule with severity, title, sites affected, files affected. Then the ignore rules table with delete (`components/ScanIgnoreList.tsx`). Phase 5 adds a "Folders" group of cards.
- **Site report**, `app/(app)/security/[siteId]/page.tsx` (`?scan=` to open an older scan): header with verdict, counts, files scanned, rules version, date, run link. Filters: severity chips (critical and warning on by default), "Show ignored". Findings **grouped by vulnerability**: one collapsible section per rule sorted by severity then count, heading = title, severity badge, file count, "NEW" when any finding is new; body = description, remediation, then the list of path, line, excerpt (excerpt rendered as a text child of `<code>`, never HTML) each with "False positive" opening `components/IgnoreFindingDialog.tsx` with three scopes: this file (`pathGlob` exact path + `ruleId`), this rule for this site, this rule globally. Database findings show the table and row identifier as the path. Below, "Scan history": one row per scan with date, counts, new count, link to the run. Client parts in `components/SecurityReport.tsx`, refreshed through `router.refresh()`.
- **Elsewhere**: `app/(app)/sites/[id]/page.tsx` gets a last-scan badge linking to the report; `components/LogModal.tsx` `RunInfo` gets a Security cell with the counts and the report link; `components/HistoryFilters.tsx` and `BackupHistory.tsx` get the Kind filter and column.

The run log itself only carries one verdict line per family and the final summary; the detail lives in the report.

Tests: `lib/db.test.ts` on `setupTestDatabase` for `getSecurityOverview` (per-site latest scan, rule table across sites, ignored excluded), `getSiteScanReport`, `markIgnored`, ignore scoping, `runKind` filtering. Routes and components have no unit tests in this repo (`vitest` includes `lib/**` only): typecheck plus the walkthrough.

Verify: the overview shows one card per site with the phase 2 counts and the "By vulnerability" table; open the site report, findings are grouped by rule with description and remediation; mark one with "this rule for this site": the section moves under "Show ignored" and the rule appears in the ignore table; "Scan now" brings it back ignored; delete the rule; "Scan now" shows it open with `isNew` false; the scan history lists both scans. History Kind filter separates scan runs; a scan row shows its options.

Docs: CLAUDE.md API table and layout, README features.

## Phase 4: notification on new findings

Commit `notifications: mail on new findings`.

- Migration `<ts>_settings_notify_findings`: `Settings.notifyOnFindings`.
- `lib/validation.ts`: the SMTP-completeness `superRefine` iterates `NOTIFY_SWITCHES = ['notifyOnError', 'notifyOnFindings']`, same 400 naming the field.
- `lib/notifications/notifier.ts`: subscribe to every terminal status except `cancelled`; `notifyFindings(backupId)` gates on the `Scan` row, not the run status (a failed push still has a valid scan): switch on, SMTP complete, findings `isNew && !ignored && severity in (critical, warning)`, critical first, capped at 50 with "and N more". Drop-and-log like failures.
- `lib/notifications/templates.ts`: `findingsMail(input)` text + HTML, subject `[Reposite] Security: N new finding(s) on <label>`, grouped by severity with the rule title, link `${appUrl}/security/<siteId>` (the report), reuse `table()` and `escapeHtml()`.
- `components/SettingsForm.tsx`: "Security findings" switch next to "Errors", description "A mail when a run finds something new. Needs the SMTP block below."

Tests: `templates.test.ts` (an excerpt with `<script>` comes out escaped, truncation), `notifier.test.ts` (switch off, no scan, only info, only ignored, one critical sent once, error status with a scan still sent), `validation.test.ts` (incomplete SMTP refused with the field named).

Verify: switch on with an incomplete SMTP block refused; complete it, "Send test mail" unchanged; plant a shell on a test site, "Scan now", one mail with the finding and the link; rerun, no mail.

Docs: CLAUDE.md notifications and API table, README, ROADMAP production checks.

## Phase 5: folder scans under SCAN_DIR

Commit `scan: folder scans from the scan directory`.

- Migration `<ts>_scan_path`: `Scan.scanPath` + index, and the `Backup` rebuild (nullable `siteId`, `scanPath`, index) under `PRAGMA defer_foreign_keys`. Before committing, check the generated `INSERT ... SELECT` lists `skipDump/skipSync/skipScan`, and replay on a copy holding real `Scan` rows so the FK from `Scan` survives the rebuild. `Backup.site` becomes optional on both sides, `onDelete` stays `Cascade`.
- `lib/paths.ts`: `scanDir()` (`SCAN_DIR` or `<DATA_DIR>/scan`) and `resolveScanPath(rel)` (resolve, prefix check, `realpathSync.native` on both, re-check: refuses `..`, absolute paths and escaping symlinks), every join with `/*turbopackIgnore: true*/`. `ensureDataDirs` creates it, ignoring `EACCES`/`EROFS` for a read-only mount. `next.config.js`: `./scan/**` in the tracing excludes.
- `lib/validation.ts`: `scanPathSchema` in the shape of `webRootPathSchema`; `runBackupSchema` gains `scanPath`, mutually exclusive with `siteIds`.
- `lib/engine/scan-run.ts`: `runFolderScan({ root, label, ignores, signal, onLog })` returning a `BackupResult`: `scanStep` with no `changedFiles`, sync and dump stats at zero, here a scanner failure is the run's outcome.
- `lib/jobs/queue.ts`: new export `enqueueFolderScan(scanPath)` next to the untouched `enqueue`, both through `insertPending` under the lock; conflict key `siteId` or `scanPath`; `BackupConflictError` takes a label; `run` branches on `scanPath` and skips `getSiteConfig` / `getGithubConfig` so a folder scan works without a GitHub token; `saveScan` baselines on `scanPath`.
- Nullable `siteId` fallout, all through one `backupLabel(row)` helper in `lib/db.ts`: `listActiveBackups`, `boot.ts` sweep, `notifier.ts` failure mail, `app/api/backups/[id]/stream/route.ts`, `BackupHistory.tsx`. `pruneBackups` in `boot.ts` gets a second pass over distinct `scanPath` values with the same keep-last-N rule.
- API: `POST /api/backups` with `{ scanPath }` resolves it, 400 when missing or not a directory, calls `enqueueFolderScan`. Security page: "Scan a folder" form in `ScanActions.tsx` (relative path, top-level entries of `SCAN_DIR` as suggestions), folder scans in their own group.
- Docker: `docker-entrypoint.sh` creates and chowns `$DATA_DIR/scan` with `files` and `sp-certificates`; `.env.example` documents `SCAN_DIR`; `docker-compose.yml` gets only a commented optional block (`- ${REPOSITE_SCAN}:/scan:ro` + `SCAN_DIR=/scan`), no mandatory variable so existing stacks redeploy unchanged.

Tests: `paths.test.ts` (`resolveScanPath` cases), `scan-run.test.ts` (temp tree success, missing folder error), `queue.test.ts` (same path conflicts, folder scan and site backup do not, runs without a GitHub token), `boot.test.ts` (prune of `scanPath` rows).

Verify: migration replayed on a production copy with Scan and Finding rows; `npm run build` (proposed) prints no "matches N files" nor "tracing of the whole project"; drop a folder with a planted shell in `data/scan/example/`, "Scan a folder", live log, the finding appears under the folder group, the site list is untouched; `../x` is refused with a 400.

Docs: CLAUDE.md (paths, queue, API), README (folder scans), ROADMAP (item out; upload, core checksums, incremental scan and rule tuning listed next).

## Risks

- **100k files**: dirent-only walk, content read only when a content rule wants the file (PHP, `.htaccess`, 256 bytes of the disguise set under uploads), 2 MB cap, one pass per file, anchored quantifier-flat regexes, `filesRead` reported for tuning. Incremental scanning of changed files only is a later optimisation.
- **False positives**: severity discipline, ignores shipped with the feature, Security page defaulting to warning and above, `smoke-scan.ts` on real clones before phase 3, rule tuning expected as a follow-up commit and said so in ROADMAP.
- **mysqldump**: `;` inside values, multi-line statements, `''` and `\'`, `_binary`, `NULL`, oversized statement skipped, non-utf8 tolerated, missing `db.sql` is a warning (normal for `skipDump`).
- **Symlinks**: never followed, counted and surfaced as a warning; with `resolveScanPath` and the `:ro` mount, a folder scan cannot read outside `SCAN_DIR`.
- **Turbopack tracer**: every new runtime `path.join` carries `/*turbopackIgnore: true*/` (precedents `paths.ts`, `git.ts`, `backup.ts`), `next.config.js` excludes `scan/`, real build checked in phase 5.
- **Retention and sweep**: both iterate sites; phase 5 handles `siteId: null` rows explicitly.
