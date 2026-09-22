import fs from 'node:fs';
import path from 'node:path';
import { errorMessage, throwIfAborted } from './cancel';
import type { RemoteClient, RemoteClientFactory, RemoteEntry } from './remote/client';
import type { Logger, SyncStats } from './types';

/** Local root entries never touched by the sync (git metadata, the dump, the README). */
export const PRESERVED = new Set(['.git', '.gitignore', 'README.md', 'db.sql']);

/** Written to the clone when it has no `.gitignore` yet. GitHub refuses files over 100 MB. */
export const GITIGNORE_TEMPLATE = '# Files GitHub refuses (> 100 MB)\n*.mmdb\n';

/**
 * Remote paths never synced, relative to the web root, with gitignore-like semantics: a pattern containing `/` is anchored at the web root, a bare name matches at any depth, a trailing `/` matches directories only (skipped without being listed), `*` matches within one path segment. Only what is regenerable or foreign to the site belongs here (archives produced by backup plugins, caches, update leftovers, logs): never uploads, plugins, themes or configuration, however large. A site-specific exclusion goes in the `.gitignore` of its repository.
 */
export const DEFAULT_EXCLUDES = [
    // Archives produced by backup plugins (UpdraftPlus, All-in-One WP Migration, Duplicator, BackWPup, WPvivid)
    'wp-content/updraft/',
    'wp-content/ai1wm-backups/',
    'wp-content/backups-dup-lite/',
    'wp-content/backups-dup-pro/',
    'wp-content/uploads/backwpup-*/',
    'wp-content/wpvividbackups/',
    // Page caches (WP Rocket, W3 Total Cache, LiteSpeed Cache, Divi)
    'wp-content/cache/',
    'wp-content/litespeed/',
    'wp-content/et-cache/',
    // Leftovers of core and plugin updates
    'wp-content/upgrade/',
    'wp-content/upgrade-temp-backup/',
    'wp-content/temp-write-test-*',
    // Logs
    'wp-content/debug.log',
    'error_log',
];

/** `relPath` is relative to the web root, without leading slash. */
export type ExcludeMatcher = (relPath: string, isDir: boolean) => boolean;

/** Compiles exclusion patterns (see `DEFAULT_EXCLUDES` for the syntax) into one matcher. */
export function compileExcludes(patterns: readonly string[]): ExcludeMatcher {
    const rules = patterns.map((pattern) => {
        const dirOnly = pattern.endsWith('/');
        const body = dirOnly ? pattern.slice(0, -1) : pattern;
        const anchor = body.includes('/') ? '^' : '(^|/)';
        const source = body
            .split('*')
            .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*');
        return { dirOnly, regex: new RegExp(`${anchor}${source}$`) };
    });
    return (relPath, isDir) =>
        rules.some((rule) => (isDir || !rule.dirOnly) && rule.regex.test(relPath));
}

export const DUMP_SCRIPT_NAME = 'dewwwe-backup.php';
export const TOKEN_FILE_NAME = '.dewwwe-backup-token';
const DUMP_FILE_PATTERN = /^db_.*\.sql$/;

/** Files the engine itself puts at the web root; never part of the synced tree. */
export function isBackupArtifact(name: string): boolean {
    return name === DUMP_SCRIPT_NAME || name === TOKEN_FILE_NAME || DUMP_FILE_PATTERN.test(name);
}

/** No traversal, no absolute path: safe to join under the local root. */
export function isSafePath(relPath: string): boolean {
    const normalized = path.normalize(relPath);
    return (
        normalized !== '..' &&
        !normalized.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(normalized)
    );
}

/**
 * Path of a remote entry inside the clone. The web root folder is kept (`www/...`), which
 * is the layout of the existing repositories.
 */
export function toRelativePath(remotePath: string): string {
    return remotePath.replace(/^\/+/, '');
}

export interface ScanResult {
    files: RemoteEntry[];
    /** Directories that could not be listed. */
    listErrors: number;
}

/**
 * Breadth-first listing of `rootDir`, one worker per client. Unlistable directories are
 * counted and skipped, so a partial scan is reported rather than thrown. Excluded entries
 * are logged and left out: an excluded directory is never listed.
 */
export async function scanRemote(
    clients: RemoteClient[],
    rootDir: string,
    log: Logger,
    signal?: AbortSignal,
    isExcluded: ExcludeMatcher = compileExcludes(DEFAULT_EXCLUDES),
): Promise<ScanResult> {
    const files: RemoteEntry[] = [];
    const pending: string[] = [rootDir];
    const waiters = new Set<() => void>();
    let active = 0;
    let listErrors = 0;

    const wakeAll = () => {
        for (const wake of waiters) wake();
        waiters.clear();
    };

    async function worker(client: RemoteClient): Promise<void> {
        for (;;) {
            throwIfAborted(signal);
            const dir = pending.shift();
            if (dir === undefined) {
                if (active === 0) return;
                await new Promise<void>((resolve) => waiters.add(resolve));
                continue;
            }
            active++;
            try {
                for (const entry of await client.list(dir)) {
                    const relPath = toRelativePath(entry.path);
                    if (!isSafePath(relPath)) continue;
                    const isDir = entry.type === 'dir';
                    const fromRoot = path.posix.relative(rootDir, entry.path);
                    if (isExcluded(fromRoot, isDir)) {
                        log.info(`  Excluded ${fromRoot}${isDir ? '/' : ''}`);
                        continue;
                    }
                    if (isDir) {
                        pending.push(entry.path);
                    } else if (!(
                        dir === rootDir && isBackupArtifact(path.posix.basename(entry.path))
                    )) {
                        files.push(entry);
                        if (files.length % 500 === 0)
                            log.info(`  ${files.length} files scanned...`);
                    }
                }
            } catch (error) {
                // A listing cut short by the cancellation (client closed) is not a listing error.
                throwIfAborted(signal);
                listErrors++;
                log.warn(`  Could not list ${dir}: ${errorMessage(error)}`);
            } finally {
                active--;
                wakeAll();
            }
        }
    }

    try {
        await Promise.all(clients.map(worker));
    } finally {
        wakeAll();
    }
    return { files, listErrors };
}

export type SyncMode = 'incremental' | 'full';

export interface SyncPlan {
    toDownload: RemoteEntry[];
    unchanged: number;
    /** Relative paths of every remote file, for orphan deletion. */
    remoteSet: Set<string>;
}

/** Tolerance on mtime comparison: FTP servers report seconds, some round. */
const MTIME_TOLERANCE_MS = 2000;

export function needsDownload(localPath: string, entry: RemoteEntry): boolean {
    const stat = fs.statSync(localPath, { throwIfNoEntry: false });
    if (!stat || !stat.isFile()) return true;
    if (stat.size !== entry.size) return true;
    return entry.mtime !== null && entry.mtime.getTime() - stat.mtimeMs > MTIME_TOLERANCE_MS;
}

export function planSync(localRoot: string, files: RemoteEntry[], mode: SyncMode): SyncPlan {
    const toDownload: RemoteEntry[] = [];
    const remoteSet = new Set<string>();
    for (const entry of files) {
        const relPath = toRelativePath(entry.path);
        remoteSet.add(relPath);
        if (mode === 'full' || needsDownload(path.join(localRoot, relPath), entry))
            toDownload.push(entry);
    }
    return { toDownload, unchanged: files.length - toDownload.length, remoteSet };
}

export interface DownloadStats {
    downloaded: number;
    failed: number;
}

/** Downloads with one worker per client. A failed file is logged and counted, not fatal. */
export async function downloadFiles(
    clients: RemoteClient[],
    localRoot: string,
    entries: RemoteEntry[],
    log: Logger,
    signal?: AbortSignal,
): Promise<DownloadStats> {
    let next = 0;
    let downloaded = 0;
    let failed = 0;

    async function worker(client: RemoteClient): Promise<void> {
        for (;;) {
            throwIfAborted(signal);
            const entry = entries[next++];
            if (!entry) return;
            const localPath = path.join(localRoot, toRelativePath(entry.path));
            try {
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                await client.download(entry.path, localPath);
                downloaded++;
                if (downloaded % 100 === 0)
                    log.info(`  ${downloaded}/${entries.length} downloaded...`);
            } catch (error) {
                failed++;
                log.warn(`  Skipped ${toRelativePath(entry.path)}: ${errorMessage(error)}`);
            }
        }
    }

    await Promise.all(clients.slice(0, Math.max(1, entries.length)).map(worker));
    return { downloaded, failed };
}

/**
 * Deletes local files absent from `remoteSet` (relative paths) and the directories left
 * empty, never touching PRESERVED root entries. Returns the number of files removed.
 */
export function deleteOrphans(localRoot: string, remoteSet: ReadonlySet<string>): number {
    let deleted = 0;

    function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(localRoot, fullPath);
            if (dir === localRoot && PRESERVED.has(entry.name)) continue;
            if (entry.isDirectory()) {
                walk(fullPath);
                if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
            } else if (!remoteSet.has(relPath.split(path.sep).join('/'))) {
                fs.unlinkSync(fullPath);
                deleted++;
            }
        }
    }

    if (fs.existsSync(localRoot)) walk(localRoot);
    return deleted;
}

export interface SyncOptions {
    mode: SyncMode;
    log: Logger;
    signal?: AbortSignal;
    /** Exclusion patterns relative to the web root, `DEFAULT_EXCLUDES` when omitted. */
    excludes?: readonly string[];
}

/**
 * Scan, plan, download, prune. Incremental mode keeps files it could not verify: when any
 * directory failed to list, orphan deletion is skipped so a flaky listing never deletes a
 * site from the backup. Full mode needs a complete listing and fails otherwise. A local file
 * under an excluded path is an orphan like any other: it leaves the tree at the next prune.
 */
export async function syncFiles(
    factory: RemoteClientFactory,
    localRoot: string,
    rootDir: string,
    options: SyncOptions,
): Promise<SyncStats> {
    const { mode, log, signal } = options;
    const isExcluded = compileExcludes(options.excludes ?? DEFAULT_EXCLUDES);
    const clients = await openPool(factory);
    try {
        log.info(`Scanning remote files (${mode})...`);
        const { files, listErrors } = await scanRemote(clients, rootDir, log, signal, isExcluded);
        if (files.length === 0 && listErrors > 0) throw new Error('Could not list any remote file');
        if (mode === 'full' && listErrors > 0)
            throw new Error(`Full download aborted: ${listErrors} directories could not be listed`);
        log.info(`  ${files.length} files found`);
        throwIfAborted(signal);

        let deleted = 0;
        if (mode === 'full') {
            deleted = deleteOrphans(localRoot, new Set());
            log.info(`  Local tree cleared (${deleted} files)`);
        }

        const plan = planSync(localRoot, files, mode);
        log.info(`  ${plan.toDownload.length} files to download, ${plan.unchanged} unchanged`);
        const { downloaded, failed } = await downloadFiles(
            clients,
            localRoot,
            plan.toDownload,
            log,
            signal,
        );
        throwIfAborted(signal);

        if (mode === 'incremental') {
            if (listErrors > 0) {
                log.warn(
                    `  Orphan deletion skipped: ${listErrors} directories could not be listed`,
                );
            } else {
                deleted = deleteOrphans(localRoot, plan.remoteSet);
            }
        }

        const stats: SyncStats = {
            scanned: files.length,
            downloaded,
            failed,
            unchanged: plan.unchanged,
            deleted,
            listErrors,
        };
        log.info(
            `Sync complete: ${downloaded} downloaded, ${plan.unchanged} unchanged, ${deleted} deleted${failed ? `, ${failed} failed` : ''}`,
        );
        return stats;
    } finally {
        await Promise.allSettled(clients.map((client) => client.close()));
    }
}

/** Opens `poolSize` connections; closes the ones opened if any fails. */
async function openPool(factory: RemoteClientFactory): Promise<RemoteClient[]> {
    const results = await Promise.allSettled(
        Array.from({ length: factory.poolSize }, () => factory.create()),
    );
    const clients = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) {
        await Promise.allSettled(clients.map((client) => client.close()));
        throw failure.reason instanceof Error ? failure.reason : new Error(String(failure.reason));
    }
    return clients;
}
