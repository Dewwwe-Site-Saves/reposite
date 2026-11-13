import { getGristConfig, getSiteSnapshot, listSites, recordGristSync } from '../db';
import { errorMessage } from '../engine/cancel';
import { appUrl } from '../env';
import { events, type DoneEvent } from '../jobs/queue';
import { prisma } from '../prisma';
import { clearSiteLink, syncSite, type SyncReport } from './sync';

/**
 * Pushes the sites to Grist when something may have changed: `start` subscribes once to the queue's `done` event and pushes the site of every job that ends, whatever its kind and its outcome, since a failed backup changes what Grist should say too. There is no schedule of its own: a push carries the whole state of the site, so one that fails is made up for by the next job of that site.
 *
 * A push never affects a run. Its outcome is kept on the site row (`gristSyncedAt`, `gristSyncError`) and shown in Settings, and a failure is logged to the console.
 */

export interface PushResult {
    siteId: number;
    domain: string;
    /** Null when the push went through. */
    error: string | null;
    report: SyncReport | null;
}

interface PushState {
    started: boolean;
    /** Pushes run one at a time: two of them for the same site would each add the row the other has not written yet. */
    chain: Promise<unknown>;
}

// Process-wide, like the queue: the boot hook and the route bundles may not share a module instance.
const globalForGrist = globalThis as unknown as { gristPush?: PushState };
const state: PushState = (globalForGrist.gristPush ??= {
    started: false,
    chain: Promise.resolve(),
});

export function start(): void {
    if (state.started) return;
    state.started = true;
    events.on('done', (event: DoneEvent) => {
        pushJobSite(event.jobId).catch((error) => {
            console.error(`[grist] job ${event.jobId}: ${errorMessage(error)}`);
        });
    });
}

async function pushJobSite(jobId: number): Promise<void> {
    // The row is gone when the site was deleted during the run.
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { siteId: true } });
    if (job) await pushSite(job.siteId);
}

/** Pushes one site. Resolves to null when Grist is not configured or the site is gone; never rejects for a push that failed, the reason is in the result. */
export function pushSite(siteId: number): Promise<PushResult | null> {
    return serialized(() => pushNow(siteId));
}

/** Pushes every site, one after the other. Empty when Grist is not configured. */
export async function pushAll(): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (const site of await listSites()) {
        const result = await pushSite(site.id);
        if (result) results.push(result);
    }
    return results;
}

/** For a site that has just been deleted: empties its link in Grist, in the background. The row and what it holds stay. */
export function unlinkSite(domain: string): Promise<void> {
    return serialized(async () => {
        try {
            const config = await getGristConfig();
            if (config) await clearSiteLink(config, domain);
        } catch (error) {
            console.error(`[grist] ${domain}: link not cleared: ${errorMessage(error)}`);
        }
    });
}

/** Resolves once every push asked for so far has ended. Tests. */
export function idle(): Promise<void> {
    return state.chain.then(() => undefined);
}

function serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = state.chain.then(task, task);
    state.chain = result.catch(() => undefined);
    return result;
}

async function pushNow(siteId: number): Promise<PushResult | null> {
    const config = await getGristConfig();
    if (!config) return null;
    const snapshot = await getSiteSnapshot(siteId, appUrl());
    if (!snapshot) return null;

    const result: PushResult = { siteId, domain: snapshot.domain, error: null, report: null };
    try {
        result.report = await syncSite(config, snapshot);
    } catch (error) {
        result.error = errorMessage(error);
        console.error(`[grist] ${snapshot.domain}: ${result.error}`);
    }
    // The push is over either way: an outcome that cannot be stored must not turn it into a rejection.
    await recordGristSync(siteId, result.error).catch((error) => {
        console.error(`[grist] ${snapshot.domain}: outcome not stored: ${errorMessage(error)}`);
    });
    return result;
}
