import { errorMessage, isCancellation } from '../cancel';
import { createLogger } from '../logger';
import { createRemoteFactory, openClient, remoteRootDir } from '../remote';
import type { Logger, RunOutcome, SiteConfig } from '../types';
import { createRemoteReader } from './reader';
import { CMS_LABELS } from './types';
import type {
    CmsAdapter,
    Component,
    Inventory,
    InventoryOptions,
    InventoryReader,
    InventoryResult,
} from './types';
import { wordpress } from './wordpress';

export { createLocalReader, createRemoteReader } from './reader';
export * from './types';

/** Tried in order, the first whose `detect` accepts the web root reads the site. */
const ADAPTERS: readonly CmsAdapter[] = [wordpress];

const TYPE_ORDER: readonly Component['type'][] = ['plugin', 'mu-plugin', 'theme'];

/**
 * Detects the CMS behind a reader and reads its version and components. Throws on anything that keeps the inventory from being complete. `where` names the place being read, for the log and the error.
 */
export async function readInventory(
    reader: InventoryReader,
    log: Logger,
    where: string,
): Promise<Inventory> {
    const rootEntries = await reader.list('');
    const adapter = ADAPTERS.find((candidate) => candidate.detect(rootEntries));
    if (!adapter) throw new Error(`No supported CMS found in ${where}`);
    const label = CMS_LABELS[adapter.id];
    log.info(`${label} detected in ${where}`);

    const { version, components } = await adapter.read(reader);
    log.info(`${label} ${version}, ${describeComponents(components)}`);
    return { cms: adapter.id, version, components: sortComponents(components) };
}

/**
 * One inventory of one live site: which CMS runs there, in which version, with which plugins and themes. Reads a handful of files over one connection and writes nothing, neither on the site nor locally. Never throws: the outcome is in `result.status`, with `errorMessage` and the complete log, and `result.inventory` is set only when everything could be read.
 */
export async function runInventory(
    site: SiteConfig,
    options: InventoryOptions = {},
): Promise<InventoryResult> {
    const { signal } = options;
    const log = createLogger(`[${site.domain}]`, options.onLog);
    const startedAt = new Date();
    const rootDir = remoteRootDir(site);
    let inventory: Inventory | null = null;
    let status: RunOutcome = 'success';
    let errorText: string | null = null;

    try {
        const client = await openClient(createRemoteFactory(site), { log, signal });
        try {
            const reader = createRemoteReader(client, rootDir, { log, signal });
            inventory = await readInventory(reader, log, rootDir);
        } finally {
            await client.close().catch(() => undefined);
        }
    } catch (error) {
        if (isCancellation(error)) {
            status = 'cancelled';
            errorText = 'Cancelled by user';
            log.warn('Inventory cancelled');
        } else {
            status = 'error';
            errorText = errorMessage(error);
            log.error(`Inventory failed: ${errorText}`);
        }
    }

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const seconds = Math.round(durationMs / 1000);
    log.info(`Inventory ${status.toUpperCase()} in ${Math.floor(seconds / 60)}m ${seconds % 60}s`);

    return {
        status,
        startedAt,
        finishedAt,
        durationMs,
        inventory,
        errorMessage: errorText,
        log: log.text(),
    };
}

function sortComponents(components: readonly Component[]): Component[] {
    return [...components].sort(
        (a, b) =>
            TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
            a.slug.localeCompare(b.slug, 'en'),
    );
}

function describeComponents(components: readonly Component[]): string {
    return TYPE_ORDER.map(
        (type) => `${components.filter((component) => component.type === type).length} ${type}`,
    ).join(', ');
}
