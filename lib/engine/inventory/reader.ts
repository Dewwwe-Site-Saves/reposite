import fs from 'node:fs';
import path from 'node:path';
import { abortable, throwIfAborted } from '../cancel';
import type { RemoteClient } from '../remote';
import type { Logger } from '../types';
import type { InventoryEntry, InventoryReader } from './types';

/** Version headers sit in files of a few KB. A larger file is not loaded into memory. */
const MAX_READ_BYTES = 1024 * 1024;

export interface ReaderOptions {
    log: Logger;
    signal?: AbortSignal;
}

/** Reads the live site over an open connection. `rootDir` is the absolute remote path of the web root. */
export function createRemoteReader(
    client: RemoteClient,
    rootDir: string,
    { log, signal }: ReaderOptions,
): InventoryReader {
    // Sizes come with the listings, so an oversized file is refused without a request.
    const sizes = new Map<string, number>();

    return {
        list: listOnce(async (dir) => {
            throwIfAborted(signal);
            const entries = await abortable(client.list(path.posix.join(rootDir, dir)), signal);
            return entries.map((entry) => {
                const name = path.posix.basename(entry.path);
                if (entry.type === 'file') sizes.set(path.posix.join(dir, name), entry.size);
                return { name, type: entry.type };
            });
        }),

        async readText(file) {
            throwIfAborted(signal);
            if (isOversized(file, sizes.get(file), log)) return '';
            const content = await abortable(client.read(path.posix.join(rootDir, file)), signal);
            return content.toString('utf8');
        },
    };
}

/** Reads the local copy of a site, the files a backup has just synced. `rootDir` is the web root inside the clone. */
export function createLocalReader(
    rootDir: string,
    { log, signal }: ReaderOptions,
): InventoryReader {
    // turbopackIgnore: runtime paths under the data directory, nothing for the build-time tracer to follow.
    const resolve = (relPath: string) => path.join(/*turbopackIgnore: true*/ rootDir, relPath);

    return {
        list: listOnce(async (dir) => {
            throwIfAborted(signal);
            const entries: InventoryEntry[] = [];
            for (const item of await fs.promises.readdir(resolve(dir), { withFileTypes: true })) {
                if (item.isDirectory()) entries.push({ name: item.name, type: 'dir' });
                else if (item.isFile()) entries.push({ name: item.name, type: 'file' });
            }
            return entries;
        }),

        async readText(file) {
            throwIfAborted(signal);
            const { size } = await fs.promises.stat(resolve(file));
            if (isOversized(file, size, log)) return '';
            return fs.promises.readFile(resolve(file), 'utf8');
        },
    };
}

/** A directory is listed once per run: adapters and the detection may ask for the same one. */
function listOnce(
    list: (dir: string) => Promise<InventoryEntry[]>,
): (dir: string) => Promise<InventoryEntry[]> {
    const listings = new Map<string, InventoryEntry[]>();
    return async (dir) => {
        const known = listings.get(dir);
        if (known) return known;
        const entries = await list(dir);
        listings.set(dir, entries);
        return entries;
    };
}

function isOversized(file: string, size: number | undefined, log: Logger): boolean {
    if (size === undefined || size <= MAX_READ_BYTES) return false;
    log.warn(`${file} is ${size} bytes, too large to hold a header: not read`);
    return true;
}
