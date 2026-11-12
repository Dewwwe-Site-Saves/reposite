/**
 * Contracts between the database layer, the job queue and the engine. The engine
 * only ever sees these decrypted, validated objects, never Prisma models.
 */

import type { Inventory } from './inventory/types';

export type Protocol = 'ftp' | 'sftp';

export interface SiteConfig {
    domain: string;
    repo: string;
    repoUrl: string;
    protocol: Protocol;
    host: string;
    port: number;
    username: string;
    password: string;
    webRootPath: string;
    spListItemId: string | null;
    /** Read the CMS and component versions from the synced files at each backup. */
    inventoryEnabled: boolean;
}

/** What a remote client needs: the connection test runs on these fields before a site exists. */
export type ConnectionConfig = Pick<
    SiteConfig,
    'protocol' | 'host' | 'port' | 'username' | 'password' | 'webRootPath'
>;

export interface GithubConfig {
    /** Commit author name. */
    name: string;
    /** Commit author email. */
    email: string;
    token: string;
}

export interface SharePointConfig {
    tenantId: string;
    clientId: string;
    certThumbprint: string;
    tenantName: string;
    siteName: string;
    listName: string;
    dateField: string;
    /** Absolute path to key.pem */
    certPath: string;
}

// ============ Logging ============

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    /** ISO 8601 */
    time: string;
    level: LogLevel;
    msg: string;
}

export interface Logger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

// ============ Runs ============

export type TriggerType = 'manual' | 'scheduled';

export type RunOutcome = 'success' | 'error' | 'cancelled';

export interface BackupOptions {
    /** Absolute path of the site's clone (`<FILES_DIR>/<repo>`). */
    localRoot: string;
    triggerType: TriggerType;
    /** Wipe the local tree and download everything instead of comparing size and mtime. */
    fullDownload: boolean;
    /** Skip commit, tag, push and Release. */
    skipGit: boolean;
    signal?: AbortSignal;
    onLog?: (entry: LogEntry) => void;
}

export interface SyncStats {
    scanned: number;
    downloaded: number;
    /** Files listed but not downloadable (permission, vanished, transfer error). */
    failed: number;
    unchanged: number;
    deleted: number;
    /** Remote directories that could not be listed. */
    listErrors: number;
}

export interface BackupResult {
    status: RunOutcome;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    filesDownloaded: number;
    filesUnchanged: number;
    filesDeleted: number;
    dumpSizeBytes: number;
    commitSha: string | null;
    tag: string | null;
    releaseUrl: string | null;
    /** What the synced files say runs on the site. Null when the site has the inventory off, when the run stopped before the sync was over, or when the reading failed (a warning in the log). */
    inventory: Inventory | null;
    errorMessage: string | null;
    /** Full text log of the run. */
    log: string;
}
