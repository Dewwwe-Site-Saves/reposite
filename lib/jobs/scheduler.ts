import { schedule, type ScheduledTask } from 'node-cron';
import { getSettings, listSites } from '../db';
import { errorMessage } from '../engine/cancel';
import { JobConflictError, enqueue } from './queue';

/**
 * One node-cron task per enabled site, firing `enqueue(siteId, { triggerType: 'scheduled' })`. The schedule is `site.cronSchedule`, or `Settings.defaultCron` when the site has none, in the `TZ` timezone. `reload()` rebuilds everything from the database and must be called after every site or settings mutation; the boot hook calls it once at startup.
 */

interface SchedulerState {
    tasks: Map<number, ScheduledTask>;
    /** Reloads run one at a time so two mutations in a row cannot double-schedule a site. */
    reloading: Promise<void>;
}

// Process-wide singleton on globalThis: `next dev` hot reloads leave no orphan cron tasks, and in production the boot hook and the route bundles may not share a module instance.
const globalForScheduler = globalThis as unknown as { backupScheduler?: SchedulerState };

const state: SchedulerState = (globalForScheduler.backupScheduler ??= {
    tasks: new Map(),
    reloading: Promise.resolve(),
});

/** Drops every task and schedules the enabled sites again from the database. */
export function reload(): Promise<void> {
    const run = state.reloading.then(rebuild, rebuild);
    state.reloading = run;
    return run;
}

/** Drops every task. Nothing runs until the next `reload()`. */
export async function stop(): Promise<void> {
    for (const task of state.tasks.values()) {
        await task.destroy();
    }
    state.tasks.clear();
}

/** Site ids with an active cron task, for status pages and tests. */
export function scheduledSiteIds(): number[] {
    return [...state.tasks.keys()];
}

async function rebuild(): Promise<void> {
    await stop();
    const [settings, sites] = await Promise.all([getSettings(), listSites()]);
    const timezone = process.env.TZ || undefined;
    const armed: string[] = [];

    for (const site of sites) {
        if (!site.enabled) continue;
        const expression = site.cronSchedule ?? settings.defaultCron;
        try {
            const task = schedule(expression, () => trigger(site.id, site.domain), { timezone });
            state.tasks.set(site.id, task);
            armed.push(`${site.domain} "${expression}"`);
        } catch (error) {
            // Expressions are validated on input; a bad one must not take the other sites down.
            console.error(
                `[scheduler] ${site.domain}: cannot schedule "${expression}": ${errorMessage(error)}`,
            );
        }
    }
    // Every reload (boot, site or settings change) shows what is armed, so a schedule edit is visible in the server log.
    console.log(
        `[scheduler] ${armed.length} site(s) scheduled (TZ ${timezone ?? 'system'})${armed.length ? ': ' + armed.join(', ') : ''}`,
    );
}

async function trigger(siteId: number, domain: string): Promise<void> {
    try {
        await enqueue(siteId, { triggerType: 'scheduled' });
    } catch (error) {
        if (error instanceof JobConflictError) {
            console.warn(`[scheduler] ${domain}: skipped, a backup is already active`);
            return;
        }
        console.error(`[scheduler] ${domain}: ${errorMessage(error)}`);
    }
}
