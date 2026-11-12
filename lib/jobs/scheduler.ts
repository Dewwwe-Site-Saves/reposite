import { schedule, type ScheduledTask } from 'node-cron';
import type { JobKind } from '../constants';
import { getSettings, listSites } from '../db';
import { errorMessage } from '../engine/cancel';
import { JobConflictError, enqueue } from './queue';

/**
 * Up to two node-cron tasks per site, each firing `enqueue(siteId, { kind, triggerType: 'scheduled' })`: a backup when the site is `enabled`, on `site.cronSchedule` or `Settings.defaultCron`, and an inventory when it is `inventoryEnabled`, on `site.inventoryCronSchedule` or `Settings.defaultInventoryCron`. The two switches are independent. Everything runs in the `TZ` timezone. `reload()` rebuilds the tasks from the database and must be called after every site or settings mutation; the boot hook calls it once at startup.
 */

interface ScheduledJob {
    siteId: number;
    kind: JobKind;
    task: ScheduledTask;
}

interface SchedulerState {
    jobs: ScheduledJob[];
    /** Reloads run one at a time so two mutations in a row cannot double-schedule a site. */
    reloading: Promise<void>;
}

// Process-wide singleton on globalThis: `next dev` hot reloads leave no orphan cron tasks, and in production the boot hook and the route bundles may not share a module instance.
const globalForScheduler = globalThis as unknown as { jobScheduler?: SchedulerState };

const state: SchedulerState = (globalForScheduler.jobScheduler ??= {
    jobs: [],
    reloading: Promise.resolve(),
});

/** Drops every task and schedules the sites again from the database. */
export function reload(): Promise<void> {
    const run = state.reloading.then(rebuild, rebuild);
    state.reloading = run;
    return run;
}

/** Drops every task. Nothing runs until the next `reload()`. */
export async function stop(): Promise<void> {
    for (const job of state.jobs) {
        await job.task.destroy();
    }
    state.jobs = [];
}

/** Site ids with an active cron task of that kind, for status pages and tests. */
export function scheduledSiteIds(kind: JobKind): number[] {
    return state.jobs.filter((job) => job.kind === kind).map((job) => job.siteId);
}

async function rebuild(): Promise<void> {
    await stop();
    const [settings, sites] = await Promise.all([getSettings(), listSites()]);
    const timezone = process.env.TZ || undefined;
    const armed: string[] = [];

    function arm(site: { id: number; domain: string }, kind: JobKind, expression: string): void {
        try {
            const task = schedule(expression, () => trigger(site.id, site.domain, kind), {
                timezone,
            });
            state.jobs.push({ siteId: site.id, kind, task });
            armed.push(`${site.domain} ${kind} "${expression}"`);
        } catch (error) {
            // Expressions are validated on input; a bad one must not take the other schedules down.
            console.error(
                `[scheduler] ${site.domain}: cannot schedule ${kind} "${expression}": ${errorMessage(error)}`,
            );
        }
    }

    for (const site of sites) {
        if (site.enabled) arm(site, 'backup', site.cronSchedule ?? settings.defaultCron);
        if (site.inventoryEnabled) {
            arm(site, 'inventory', site.inventoryCronSchedule ?? settings.defaultInventoryCron);
        }
    }
    // Every reload (boot, site or settings change) shows what is armed, so a schedule edit is visible in the server log.
    console.log(
        `[scheduler] ${armed.length} schedule(s) armed (TZ ${timezone ?? 'system'})${armed.length ? ': ' + armed.join(', ') : ''}`,
    );
}

async function trigger(siteId: number, domain: string, kind: JobKind): Promise<void> {
    try {
        await enqueue(siteId, { kind, triggerType: 'scheduled' });
    } catch (error) {
        if (error instanceof JobConflictError) {
            console.warn(`[scheduler] ${domain}: ${kind} skipped, another job is active`);
            return;
        }
        console.error(`[scheduler] ${domain}: ${kind}: ${errorMessage(error)}`);
    }
}
