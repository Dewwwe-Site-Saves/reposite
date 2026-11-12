import path from 'node:path';
import { abortable, errorMessage, isCancellation, throwIfAborted } from '../cancel';
import { createLogger } from '../logger';
import { createRemoteFactory, openClient, remoteRootDir, type RemoteClient } from '../remote';
import type { Logger, RunOutcome, SiteConfig } from '../types';
import type {
    CmsAdapter,
    Component,
    Inventory,
    InventoryEntry,
    InventoryOptions,
    InventoryReader,
    InventoryResult,
} from './types';
import { wordpress } from './wordpress';

export type * from './types';

/** Tried in order, the first whose `detect` accepts the web root reads the site. */
const ADAPTERS: readonly CmsAdapter[] = [wordpress];

/** Version headers sit in files of a few KB. Anything a listing shows above this is not downloaded into memory. */
const MAX_READ_BYTES = 1024 * 1024;

const TYPE_ORDER: readonly Component['type'][] = ['plugin', 'mu-plugin', 'theme'];

/**
 * One inventory of one site: which CMS runs there, in which version, with which plugins and themes. Reads a handful of files over one connection and writes nothing, neither on the site nor locally. Never throws: the outcome is in `result.status`, with `errorMessage` and the complete log, and `result.inventory` is set only when everything could be read.
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
            const reader = createReader(client, rootDir, log, signal);
            const rootEntries = await reader.list('');
            const adapter = ADAPTERS.find((candidate) => candidate.detect(rootEntries));
            if (!adapter) throw new Error(`No supported CMS found in ${rootDir}`);
            log.info(`${adapter.label} detected in ${rootDir}`);

            const { version, components } = await adapter.read(reader);
            inventory = { cms: adapter.id, version, components: sortComponents(components) };
            log.info(`${adapter.label} ${version}, ${describeComponents(components)}`);
        } finally {
            await client.close().catch(() => undefined);
        }
    } catch (error) {
        inventory = null;
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

function createReader(
    client: RemoteClient,
    rootDir: string,
    log: Logger,
    signal: AbortSignal | undefined,
): InventoryReader {
    const listings = new Map<string, InventoryEntry[]>();
    const sizes = new Map<string, number>();

    return {
        async list(dir) {
            const known = listings.get(dir);
            if (known) return known;
            throwIfAborted(signal);
            const remoteDir = path.posix.join(rootDir, dir);
            const entries = (await abortable(client.list(remoteDir), signal)).map((entry) => ({
                name: path.posix.basename(entry.path),
                type: entry.type,
                size: entry.size,
            }));
            for (const entry of entries) {
                if (entry.type === 'file') sizes.set(path.posix.join(dir, entry.name), entry.size);
            }
            listings.set(dir, entries);
            return entries;
        },

        async readText(file) {
            throwIfAborted(signal);
            const size = sizes.get(file);
            if (size !== undefined && size > MAX_READ_BYTES) {
                log.warn(`${file} is ${size} bytes, too large to hold a header: not read`);
                return '';
            }
            const content = await abortable(client.read(path.posix.join(rootDir, file)), signal);
            return content.toString('utf8');
        },
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
