import { schedule, type ScheduledTask } from 'node-cron';
import { assertEncryptionKey } from '../crypto';
import { getSettings } from '../db';
import { errorMessage } from '../engine/cancel';
import * as notifier from '../notifications/notifier';
import { initDatabase, prisma } from '../prisma';
import { ACTIVE_STATUSES } from '../validation';
import * as scheduler from './scheduler';

/**
 * Server start-up, called once from `instrumentation.ts`: environment checks, database pragmas, orphan job sweep, scheduler, daily retention. A second call in the same process (dev hot reload) skips the sweep, the queue is still alive and its rows are not orphans.
 */

/** Backups to keep per site whatever their age. */
export const RETENTION_KEEP_LAST = 5;

/** Runs at 04:00 in `TZ`, an hour after the default backup slot. */
const RETENTION_CRON = '0 4 * * *';

interface BootState {
    booted: boolean;
    retention: ScheduledTask | null;
}

// Process-wide, like the queue and scheduler state: the boot hook and the route bundles may not share a module instance.
const globalForBoot = globalThis as unknown as { backupBoot?: BootState };
const state: BootState = (globalForBoot.backupBoot ??= { booted: false, retention: null });

export async function boot(): Promise<void> {
    checkEnvironment();
    await initDatabase();

    if (!state.booted) {
        const swept = await sweepInterruptedJobs();
        if (swept.length > 0) {
            console.warn(`[boot] ${swept.length} backup(s) interrupted by the last restart`);
            // In the background: the first request must not wait for the mail server.
            notifier
                .notifyInterrupted(swept)
                .catch((error) => console.error(`[notify] interrupted: ${errorMessage(error)}`));
        }
        state.booted = true;
    }

    notifier.start();
    await scheduler.reload();

    await state.retention?.destroy();
    state.retention = schedule(RETENTION_CRON, runRetention, {
        timezone: process.env.TZ || undefined,
    });
    // Catch-up run in the background: the first request must not wait for the deletions.
    void runRetention();
}

/** Drops the retention task and the scheduler. Tests and graceful shutdown. */
export async function shutdown(): Promise<void> {
    await state.retention?.destroy();
    state.retention = null;
    await scheduler.stop();
}

/** Production refuses to start without its secrets; development gets a warning. */
export function checkEnvironment(): void {
    const missing = ['ENCRYPTION_KEY', 'SESSION_SECRET'].filter((name) => !process.env[name]);
    if (missing.length === 0) {
        assertEncryptionKey();
        return;
    }
    const message = `Missing environment variable(s): ${missing.join(', ')}`;
    if (process.env.NODE_ENV === 'production') throw new Error(message);
    console.warn(`[boot] ${message}`);
}

/** Rows still `pending` or `running` at start-up belonged to the previous process: nothing will ever finish them. Returns the domain of each row swept, for the notification. */
export async function sweepInterruptedJobs(): Promise<string[]> {
    const rows = await prisma.job.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, site: { select: { domain: true } } },
        orderBy: { id: 'asc' },
    });
    if (rows.length === 0) return [];
    await prisma.job.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
            status: 'error',
            finishedAt: new Date(),
            errorMessage: 'Interrupted by server restart',
        },
    });
    return rows.map((row) => row.site.domain);
}

/** Deletes backups older than `Settings.retentionDays`, always keeping the last `RETENTION_KEEP_LAST` per site and never an active one. Returns the number of rows deleted. */
export async function pruneJobs(now = new Date()): Promise<number> {
    const { retentionDays } = await getSettings();
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const sites = await prisma.site.findMany({ select: { id: true } });

    let deleted = 0;
    for (const site of sites) {
        const kept = await prisma.job.findMany({
            where: { siteId: site.id },
            orderBy: { id: 'desc' },
            take: RETENTION_KEEP_LAST,
            select: { id: true },
        });
        const { count } = await prisma.job.deleteMany({
            where: {
                siteId: site.id,
                id: { notIn: kept.map((b) => b.id) },
                status: { notIn: [...ACTIVE_STATUSES] },
                queuedAt: { lt: cutoff },
            },
        });
        deleted += count;
    }
    return deleted;
}

async function runRetention(): Promise<void> {
    try {
        const deleted = await pruneJobs();
        if (deleted > 0) console.log(`[retention] deleted ${deleted} old backup(s)`);
    } catch (error) {
        console.error(`[retention] ${errorMessage(error)}`);
    }
}
