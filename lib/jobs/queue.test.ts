import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { abortable, isCancellation } from '../engine/cancel';
import type { BackupOptions, BackupResult, LogEntry } from '../engine/types';
import { setupTestDatabase } from '../testing/db';
import type { DoneEvent, LogEvent, StatusEvent } from './queue';

// The engine is replaced by a fake that logs one line, then waits until the test releases it.
// Everything else — Prisma, the crypto helpers, the config loaders — runs for real on a
// throwaway SQLite database, so the database must be in place before those modules load.
const { engine } = vi.hoisted(() => ({
    engine: {
        gates: [] as (() => void)[],
        calls: [] as BackupOptions[],
        outcome: 'success' as BackupResult['status'],
    },
}));

vi.mock('../engine/backup', () => ({
    runBackup: async (
        _site: unknown,
        _github: unknown,
        _sharepoint: unknown,
        options: BackupOptions,
    ): Promise<BackupResult> => {
        engine.calls.push(options);
        const startedAt = new Date();
        options.onLog?.({ time: startedAt.toISOString(), level: 'info', msg: 'fake run' });
        let status = engine.outcome;
        try {
            await abortable(
                new Promise<void>((resolve) => engine.gates.push(resolve)),
                options.signal,
            );
        } catch (error) {
            if (!isCancellation(error)) throw error;
            status = 'cancelled';
        }
        const finishedAt = new Date();
        return {
            status,
            startedAt,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
            filesDownloaded: 3,
            filesUnchanged: 7,
            filesDeleted: 1,
            dumpSizeBytes: 1024,
            commitSha: status === 'success' ? 'abc123' : null,
            tag: status === 'success' ? '20260904-120000' : null,
            releaseUrl: null,
            errorMessage: status === 'success' ? null : `fake ${status}`,
            log: 'fake log',
        };
    },
}));

const { prisma, dataDir, cleanup } = await setupTestDatabase();
const { encrypt } = await import('../crypto');
const { getSettings, listActiveJobs } = await import('../db');
const queue = await import('./queue');

let siteA: number;
let siteB: number;

async function createSite(domain: string): Promise<number> {
    const site = await prisma.site.create({
        data: {
            domain,
            repo: domain.replace(/\./g, '-'),
            repoUrl: `https://github.com/acme/${domain}.git`,
            host: 'ftp.example.com',
            port: 21,
            username: 'user',
            passwordEnc: encrypt('secret'),
        },
    });
    return site.id;
}

function releaseNext(): void {
    engine.gates.shift()!();
}

function waitDone(jobId: number): Promise<DoneEvent> {
    return new Promise((resolve) => {
        const listener = (event: DoneEvent) => {
            if (event.jobId !== jobId) return;
            queue.events.off('done', listener);
            resolve(event);
        };
        queue.events.on('done', listener);
    });
}

/** Lines buffered for a backup right now, through a throwaway subscription. */
function buffered(jobId: number): readonly LogEntry[] {
    const subscription = queue.subscribe(jobId, { onDone: () => {} });
    subscription.unsubscribe();
    return subscription.lines;
}

async function waitStarted(count: number): Promise<void> {
    await vi.waitFor(() => expect(engine.calls.length).toBe(count));
}

beforeAll(async () => {
    siteA = await createSite('a.example.com');
    siteB = await createSite('b.example.com');
});

afterAll(cleanup);

beforeEach(async () => {
    engine.gates = [];
    engine.calls = [];
    engine.outcome = 'success';
    await prisma.job.deleteMany();
    await getSettings();
    await prisma.settings.update({
        where: { id: 1 },
        data: { concurrency: 2, githubEmail: 'bot@example.com', githubTokenEnc: encrypt('tok') },
    });
});

describe('enqueue', () => {
    it('creates the pending row and rejects a second active backup for the same site', async () => {
        const id = await queue.enqueue(siteA, { fullDownload: true });
        const row = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ siteId: siteA, fullDownload: true, skipGit: false });

        await waitStarted(1);
        await expect(queue.enqueue(siteA)).rejects.toBeInstanceOf(queue.JobConflictError);
        const other = await queue.enqueue(siteB);
        expect(other).toBeGreaterThan(id);

        await waitStarted(2);
        releaseNext();
        releaseNext();
        await Promise.all([waitDone(id), waitDone(other)]);
    });

    it('rejects an unknown site', async () => {
        await expect(queue.enqueue(999999)).rejects.toThrow('Site not found');
    });
});

describe('worker', () => {
    it('runs the job and stores the engine result', async () => {
        const logs: LogEvent[] = [];
        const onLog = (event: LogEvent) => logs.push(event);
        queue.events.on('log', onLog);

        const id = await queue.enqueue(siteA, { skipGit: true, triggerType: 'scheduled' });
        await waitStarted(1);

        const running = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(running.status).toBe('running');
        expect(running.startedAt).not.toBeNull();
        expect(engine.calls[0]).toMatchObject({
            skipGit: true,
            fullDownload: false,
            triggerType: 'scheduled',
        });
        expect(engine.calls[0].localRoot).toBe(path.join(dataDir, 'files', 'a-example-com'));
        expect(buffered(id)).toEqual([expect.objectContaining({ msg: 'fake run' })]);
        expect(await listActiveJobs()).toEqual([
            { id, siteId: siteA, domain: 'a.example.com', status: 'running' },
        ]);

        releaseNext();
        const done = await waitDone(id);
        queue.events.off('log', onLog);

        expect(done.status).toBe('success');
        expect(logs).toEqual([{ jobId: id, entry: expect.objectContaining({ msg: 'fake run' }) }]);
        expect(buffered(id)).toEqual([]);
        const stored = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(stored).toMatchObject({
            status: 'success',
            filesDownloaded: 3,
            filesUnchanged: 7,
            filesDeleted: 1,
            dumpSizeBytes: 1024,
            commitSha: 'abc123',
            tag: '20260904-120000',
            errorMessage: null,
            log: 'fake log',
        });
        expect(stored.finishedAt).not.toBeNull();
        expect(await listActiveJobs()).toEqual([]);
    });

    it('copies an error outcome as-is', async () => {
        engine.outcome = 'error';
        const id = await queue.enqueue(siteA);
        await waitStarted(1);
        releaseNext();
        expect((await waitDone(id)).status).toBe('error');
        const stored = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(stored).toMatchObject({ status: 'error', errorMessage: 'fake error' });
    });

    it('respects Settings.concurrency, oldest first', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { concurrency: 1 } });
        const first = await queue.enqueue(siteA);
        const second = await queue.enqueue(siteB);
        await waitStarted(1);

        const statuses = async () => (await listActiveJobs()).map((b) => [b.id, b.status] as const);
        expect(await statuses()).toEqual([
            [first, 'running'],
            [second, 'pending'],
        ]);

        releaseNext();
        await waitDone(first);
        await waitStarted(2);
        expect(await statuses()).toEqual([[second, 'running']]);

        releaseNext();
        await waitDone(second);
        expect(await statuses()).toEqual([]);
    });

    it('fails the job when GitHub is not configured, keeping the log', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { githubTokenEnc: null } });
        const id = await queue.enqueue(siteA);
        const done = await waitDone(id);
        expect(done.status).toBe('error');
        expect(engine.calls).toHaveLength(0);

        const stored = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(stored.status).toBe('error');
        expect(stored.errorMessage).toMatch(/GitHub token/);
        expect(stored.log).toMatch(/\[error\] GitHub token/);
    });
});

describe('cancel', () => {
    it('cancels a pending backup immediately', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { concurrency: 1 } });
        const first = await queue.enqueue(siteA);
        const second = await queue.enqueue(siteB);
        await waitStarted(1);

        const done = waitDone(second);
        expect(await queue.cancel(second)).toBe(true);
        expect((await done).status).toBe('cancelled');
        const stored = await prisma.job.findUniqueOrThrow({ where: { id: second } });
        expect(stored).toMatchObject({ status: 'cancelled', errorMessage: 'Cancelled by user' });
        expect(stored.finishedAt).not.toBeNull();

        releaseNext();
        await waitDone(first);
        // The cancelled row was never claimed by the worker.
        expect(engine.calls).toHaveLength(1);
    });

    it('aborts a running backup and lets the engine set the final status', async () => {
        const id = await queue.enqueue(siteA);
        await waitStarted(1);

        expect(await queue.cancel(id)).toBe(true);
        expect(engine.calls[0].signal?.aborted).toBe(true);
        expect((await waitDone(id)).status).toBe('cancelled');
        const stored = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(stored).toMatchObject({ status: 'cancelled', errorMessage: 'fake cancelled' });
    });

    it('returns false for finished or unknown backups', async () => {
        const id = await queue.enqueue(siteA);
        await waitStarted(1);
        releaseNext();
        await waitDone(id);

        expect(await queue.cancel(id)).toBe(false);
        expect(await queue.cancel(999999)).toBe(false);
    });
});

describe('subscribe', () => {
    it('replays the buffer, then forwards log and done for that backup only', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { concurrency: 1 } });
        const first = await queue.enqueue(siteA);
        const second = await queue.enqueue(siteB);
        await waitStarted(1);

        const seen: string[] = [];
        const subscription = queue.subscribe(second, {
            onLog: (entry) => seen.push(`log:${entry.msg}`),
            onStatus: (event) => seen.push(`status:${event.status}`),
            onDone: (status) => seen.push(`done:${status}`),
        });
        expect(subscription.lines).toEqual([]);

        releaseNext();
        await waitDone(first);
        await waitStarted(2);
        releaseNext();
        await waitDone(second);

        expect(seen).toEqual(['status:running', 'log:fake run', 'done:success']);
        expect(queue.events.listenerCount('done')).toBe(0);
    });

    it('emits status with the claim time', async () => {
        const before = Date.now();
        const statuses: StatusEvent[] = [];
        const onStatus = (event: StatusEvent) => statuses.push(event);
        queue.events.on('status', onStatus);

        const id = await queue.enqueue(siteA);
        await waitStarted(1);
        queue.events.off('status', onStatus);

        expect(statuses).toEqual([{ jobId: id, status: 'running', startedAt: expect.any(String) }]);
        expect(Date.parse(statuses[0].startedAt)).toBeGreaterThanOrEqual(before);
        const row = await prisma.job.findUniqueOrThrow({ where: { id } });
        expect(row.startedAt?.toISOString()).toBe(statuses[0].startedAt);

        releaseNext();
        await waitDone(id);
    });
});

describe('log lines', () => {
    it('are the LogEntry objects forwarded by the engine', async () => {
        const id = await queue.enqueue(siteA);
        await waitStarted(1);
        const lines = buffered(id);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({ level: 'info', msg: 'fake run' });
        releaseNext();
        await waitDone(id);
    });
});
