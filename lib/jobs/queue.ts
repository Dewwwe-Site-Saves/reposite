import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
    getGithubConfig,
    getSettings,
    getSharePointConfig,
    getSite,
    getSiteConfig,
    saveInventory,
} from '../db';
import { runBackup } from '../engine/backup';
import { errorMessage } from '../engine/cancel';
import { runInventory, type Inventory } from '../engine/inventory';
import { formatLog } from '../engine/logger';
import type { LogEntry, SiteConfig } from '../engine/types';
import { filesDir } from '../paths';
import { prisma } from '../prisma';
import { ACTIVE_STATUSES, type JobKind, type JobStatus, type TriggerType } from '../validation';

/**
 * DB-first job queue. The `Job` row is the job: created as `pending` at enqueue time, claimed as `running` by the worker loop, updated with the engine result at the end. Its `kind` picks the engine entry point: `runBackup` or `runInventory`. The only in-memory state is what cannot live in the database, the AbortController and the log buffer of the runs in progress, so a restart leaves nothing behind except rows to sweep.
 */

export interface EnqueueOptions {
    /** `backup` when omitted. */
    kind?: JobKind;
    /** Backups only. */
    fullDownload?: boolean;
    /** Backups only. */
    skipGit?: boolean;
    triggerType?: TriggerType;
}

export interface LogEvent {
    jobId: number;
    entry: LogEntry;
}

/** Emitted when the worker claims a pending row. */
export interface StatusEvent {
    jobId: number;
    status: 'running';
    /** ISO 8601 */
    startedAt: string;
}

export interface DoneEvent {
    jobId: number;
    status: JobStatus;
}

export interface JobListeners {
    onLog?: (entry: LogEntry) => void;
    onStatus?: (event: StatusEvent) => void;
    onDone: (status: JobStatus) => void;
}

export interface Subscription {
    /** Lines buffered before the subscription: empty for a pending job and once the run is over. */
    lines: readonly LogEntry[];
    unsubscribe: () => void;
}

/** Thrown by `enqueue` when the site already has a pending or running job, of any kind: two runs on one site would compete for the few connections its host allows. */
export class JobConflictError extends Error {
    constructor(siteId: number) {
        super(`A job is already pending or running for site ${siteId}`);
        this.name = 'JobConflictError';
    }
}

type QueueEvents = { log: [LogEvent]; status: [StatusEvent]; done: [DoneEvent] };

interface RunningJob {
    abort: AbortController;
    logLines: LogEntry[];
}

interface PendingRow {
    id: number;
    siteId: number;
    kind: string;
    triggerType: string;
    fullDownload: boolean;
    skipGit: boolean;
}

interface QueueState {
    running: Map<number, RunningJob>;
    events: EventEmitter<QueueEvents>;
    /** Enqueues run one at a time: the conflict check and the insert must not interleave. */
    enqueueLock: Promise<unknown>;
    /** Fill passes run one at a time; a call during a pass queues another one. */
    dispatching: Promise<void>;
}

// Process-wide singleton on globalThis: `next dev` hot reloads keep the running jobs and the listeners, and in production the boot hook and the route bundles may not share a module instance.
const globalForQueue = globalThis as unknown as { jobQueue?: QueueState };

const state: QueueState = (globalForQueue.jobQueue ??= {
    running: new Map(),
    events: new EventEmitter<QueueEvents>({ captureRejections: false }),
    enqueueLock: Promise.resolve(),
    dispatching: Promise.resolve(),
});
state.events.setMaxListeners(100);

/** `log` and `status` while a run is in progress, `done` once its final status is stored. Prefer `subscribe` for a single job. */
export const events = state.events;

/**
 * Creates the `pending` Job row and returns its id. Rejects with `JobConflictError` when the site already has an active job. The check and the insert run under an in-process lock rather than a database transaction: the app is a single process, so the lock is enough, and it keeps the queue off Prisma interactive transactions on the single-connection better-sqlite3 adapter.
 */
export async function enqueue(siteId: number, options: EnqueueOptions = {}): Promise<number> {
    const insert = () => insertPending(siteId, options);
    const result = state.enqueueLock.then(insert, insert);
    state.enqueueLock = result.catch(() => undefined);
    const jobId = await result;
    dispatch();
    return jobId;
}

async function insertPending(siteId: number, options: EnqueueOptions): Promise<number> {
    if (!(await getSite(siteId))) throw new Error(`Site not found: ${siteId}`);

    const active = await prisma.job.findFirst({
        where: { siteId, status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true },
    });
    if (active) throw new JobConflictError(siteId);

    const created = await prisma.job.create({
        data: {
            siteId,
            kind: options.kind ?? 'backup',
            triggerType: options.triggerType ?? 'manual',
            fullDownload: options.fullDownload === true,
            skipGit: options.skipGit === true,
        },
        select: { id: true },
    });
    return created.id;
}

/**
 * Pending: marked `cancelled` right away. Running: the engine is asked to stop and stores the final status itself. Returns false when the job is unknown or already finished.
 */
export async function cancel(jobId: number): Promise<boolean> {
    const pending = await prisma.job.updateMany({
        where: { id: jobId, status: 'pending' },
        data: { status: 'cancelled', finishedAt: new Date(), errorMessage: 'Cancelled by user' },
    });
    if (pending.count === 1) {
        state.events.emit('done', { jobId, status: 'cancelled' });
        return true;
    }
    const job = state.running.get(jobId);
    if (!job) return false;
    job.abort.abort();
    return true;
}

/**
 * Registers listeners for one job and returns the lines buffered so far, both in the same tick, so nothing emitted in between can be missed. The listeners are removed on `done`.
 */
export function subscribe(jobId: number, listeners: JobListeners): Subscription {
    const onLog = (event: LogEvent) => {
        if (event.jobId === jobId) listeners.onLog?.(event.entry);
    };
    const onStatus = (event: StatusEvent) => {
        if (event.jobId === jobId) listeners.onStatus?.(event);
    };
    const onDone = (event: DoneEvent) => {
        if (event.jobId !== jobId) return;
        unsubscribe();
        listeners.onDone(event.status);
    };
    const unsubscribe = () => {
        state.events.off('log', onLog);
        state.events.off('status', onStatus);
        state.events.off('done', onDone);
    };
    state.events.on('log', onLog);
    state.events.on('status', onStatus);
    state.events.on('done', onDone);
    return { lines: [...(state.running.get(jobId)?.logLines ?? [])], unsubscribe };
}

/** Worker loop: one fill pass at a time, re-entered after every enqueue and every completion. A pass with nothing to claim costs two reads. */
function dispatch(): void {
    const pass = () =>
        fillSlots().catch((error) => console.error(`[queue] dispatch: ${errorMessage(error)}`));
    state.dispatching = state.dispatching.then(pass, pass);
}

async function fillSlots(): Promise<void> {
    const { concurrency } = await getSettings();
    while (state.running.size < concurrency) {
        const next = await prisma.job.findFirst({
            where: { status: 'pending' },
            orderBy: { id: 'asc' },
            select: {
                id: true,
                siteId: true,
                kind: true,
                triggerType: true,
                fullDownload: true,
                skipGit: true,
            },
        });
        if (!next) return;

        // In memory before the claim, so a cancel landing in between finds the job and aborts it instead of being refused.
        const job: RunningJob = { abort: new AbortController(), logLines: [] };
        state.running.set(next.id, job);
        const startedAt = new Date();
        const claimed = await prisma.job.updateMany({
            where: { id: next.id, status: 'pending' },
            data: { status: 'running', startedAt },
        });
        if (claimed.count === 0) {
            // Cancelled between the read and the claim.
            state.running.delete(next.id);
            continue;
        }
        state.events.emit('status', {
            jobId: next.id,
            status: 'running',
            startedAt: startedAt.toISOString(),
        });
        void run(next, job).finally(dispatch);
    }
}

type JobUpdate = Parameters<typeof prisma.job.updateMany>[0]['data'];

/** What an engine run leaves to store: the final columns of the row and, when one was read in full, the site's inventory. */
interface Execution {
    final: JobUpdate & { status: JobStatus; finishedAt: Date };
    inventory: Inventory | null;
}

async function run(row: PendingRow, job: RunningJob): Promise<void> {
    const jobId = row.id;
    const onLog = (entry: LogEntry) => {
        job.logLines.push(entry);
        state.events.emit('log', { jobId, entry });
    };

    let status: JobStatus;
    try {
        let execution: Execution;
        try {
            const site = await getSiteConfig(row.siteId);
            if (!site) throw new Error('Site was deleted');
            execution =
                row.kind === 'inventory'
                    ? await executeInventory(site, job, onLog)
                    : await executeBackup(site, row, job, onLog);
        } catch (error) {
            // Only reached when the configuration could not be loaded: the engines never throw.
            const cancelled = job.abort.signal.aborted;
            const message = cancelled ? 'Cancelled by user' : errorMessage(error);
            onLog({ time: new Date().toISOString(), level: 'error', msg: message });
            execution = {
                final: {
                    status: cancelled ? 'cancelled' : 'error',
                    finishedAt: new Date(),
                    errorMessage: message,
                    log: formatLog(job.logLines),
                },
                inventory: null,
            };
        }
        status = execution.final.status;
        // updateMany rather than update: deleting the site cascades to the row while it runs.
        await prisma.job.updateMany({ where: { id: jobId }, data: execution.final });
        if (execution.inventory) {
            await storeInventory(row.siteId, execution.inventory, execution.final.finishedAt);
        }
    } catch (error) {
        status = 'error';
        console.error(`[queue] job ${jobId}: ${errorMessage(error)}`);
    } finally {
        // Gone from the running set before listeners hear about it.
        state.running.delete(jobId);
    }
    state.events.emit('done', { jobId, status });
}

async function executeBackup(
    site: SiteConfig,
    row: PendingRow,
    job: RunningJob,
    onLog: (entry: LogEntry) => void,
): Promise<Execution> {
    const [github, sharepoint] = await Promise.all([getGithubConfig(), getSharePointConfig()]);
    if (!github) throw new Error('GitHub token and email are not configured (Settings)');

    const result = await runBackup(site, github, sharepoint, {
        localRoot: path.join(filesDir(), site.repo),
        triggerType: row.triggerType as TriggerType,
        fullDownload: row.fullDownload,
        skipGit: row.skipGit,
        signal: job.abort.signal,
        onLog,
    });
    return {
        final: {
            status: result.status,
            finishedAt: result.finishedAt,
            durationMs: result.durationMs,
            filesDownloaded: result.filesDownloaded,
            filesUnchanged: result.filesUnchanged,
            filesDeleted: result.filesDeleted,
            dumpSizeBytes: result.dumpSizeBytes,
            commitSha: result.commitSha,
            tag: result.tag,
            releaseUrl: result.releaseUrl,
            errorMessage: result.errorMessage,
            log: result.log,
        },
        // Whatever the outcome: the inventory was read from files the sync had just completed, a push that fails afterwards does not make it wrong.
        inventory: result.inventory,
    };
}

async function executeInventory(
    site: SiteConfig,
    job: RunningJob,
    onLog: (entry: LogEntry) => void,
): Promise<Execution> {
    const result = await runInventory(site, { signal: job.abort.signal, onLog });
    return {
        final: {
            status: result.status,
            finishedAt: result.finishedAt,
            durationMs: result.durationMs,
            errorMessage: result.errorMessage,
            log: result.log,
        },
        inventory: result.inventory,
    };
}

/** The job row already carries the outcome of the run: an inventory that cannot be stored (the site was deleted meanwhile) is logged, it does not turn the job into a failure. */
async function storeInventory(siteId: number, inventory: Inventory, readAt: Date): Promise<void> {
    try {
        await saveInventory(siteId, inventory, readAt);
    } catch (error) {
        console.error(`[queue] site ${siteId}: inventory not stored: ${errorMessage(error)}`);
    }
}
