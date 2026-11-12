import { EventEmitter } from 'node:events';
import path from 'node:path';
import { getGithubConfig, getSettings, getSharePointConfig, getSite, getSiteConfig } from '../db';
import { runBackup } from '../engine/backup';
import { errorMessage } from '../engine/cancel';
import { formatLog } from '../engine/logger';
import type { LogEntry } from '../engine/types';
import { filesDir } from '../paths';
import { prisma } from '../prisma';
import { ACTIVE_STATUSES, type JobStatus, type TriggerType } from '../validation';

/**
 * DB-first job queue. The `Job` row is the job: created as `pending` at enqueue time, claimed as `running` by the worker loop, updated with the engine result at the end. The only in-memory state is what cannot live in the database, the AbortController and the log buffer of the runs in progress, so a restart leaves nothing behind except rows to sweep.
 */

export interface EnqueueOptions {
    fullDownload?: boolean;
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
    /** Lines buffered before the subscription: empty for a pending backup and once the run is over. */
    lines: readonly LogEntry[];
    unsubscribe: () => void;
}

/** Thrown by `enqueue` when the site already has a pending or running backup. */
export class JobConflictError extends Error {
    constructor(siteId: number) {
        super(`A backup is already pending or running for site ${siteId}`);
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

/** `log` and `status` while a run is in progress, `done` once its final status is stored. Prefer `subscribe` for a single backup. */
export const events = state.events;

/**
 * Creates the `pending` Job row and returns its id. Rejects with `JobConflictError` when the site already has an active backup. The check and the insert run under an in-process lock rather than a database transaction: the app is a single process, so the lock is enough, and it keeps the queue off Prisma interactive transactions on the single-connection better-sqlite3 adapter.
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
            triggerType: options.triggerType ?? 'manual',
            fullDownload: options.fullDownload === true,
            skipGit: options.skipGit === true,
        },
        select: { id: true },
    });
    return created.id;
}

/**
 * Pending: marked `cancelled` right away. Running: the engine is asked to stop and stores the final status itself. Returns false when the backup is unknown or already finished.
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
 * Registers listeners for one backup and returns the lines buffered so far, both in the same tick, so nothing emitted in between can be missed. The listeners are removed on `done`.
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

async function run(row: PendingRow, job: RunningJob): Promise<void> {
    const jobId = row.id;
    const onLog = (entry: LogEntry) => {
        job.logLines.push(entry);
        state.events.emit('log', { jobId, entry });
    };

    let status: JobStatus;
    try {
        let final: Parameters<typeof prisma.job.updateMany>[0]['data'];
        try {
            const [site, github, sharepoint] = await Promise.all([
                getSiteConfig(row.siteId),
                getGithubConfig(),
                getSharePointConfig(),
            ]);
            if (!site) throw new Error('Site was deleted');
            if (!github) throw new Error('GitHub token and email are not configured (Settings)');

            const result = await runBackup(site, github, sharepoint, {
                localRoot: path.join(filesDir(), site.repo),
                triggerType: row.triggerType as TriggerType,
                fullDownload: row.fullDownload,
                skipGit: row.skipGit,
                signal: job.abort.signal,
                onLog,
            });
            status = result.status;
            final = {
                status,
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
            };
        } catch (error) {
            // Only reached when the configuration could not be loaded: the engine never throws.
            const cancelled = job.abort.signal.aborted;
            status = cancelled ? 'cancelled' : 'error';
            const message = cancelled ? 'Cancelled by user' : errorMessage(error);
            onLog({ time: new Date().toISOString(), level: 'error', msg: message });
            final = {
                status,
                finishedAt: new Date(),
                errorMessage: message,
                log: formatLog(job.logLines),
            };
        }
        // updateMany rather than update: deleting the site cascades to the row while it runs.
        await prisma.job.updateMany({ where: { id: jobId }, data: final });
    } catch (error) {
        status = 'error';
        console.error(`[queue] job ${jobId}: ${errorMessage(error)}`);
    } finally {
        // Gone from the running set before listeners hear about it.
        state.running.delete(jobId);
    }
    state.events.emit('done', { jobId, status });
}
