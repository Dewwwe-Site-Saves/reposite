import path from 'node:path';
import type { ConnectionConfig, SiteConfig } from '../types';
import type { RemoteClient, RemoteClientFactory, RemoteEntry } from './client';
import { createFtpFactory } from './ftp';
import { createSftpFactory } from './sftp';

export type { RemoteClient, RemoteClientFactory, RemoteEntry } from './client';
export { CONNECT_RETRY_DELAYS_MS, openClient, type ConnectOptions } from './connect';

export function createRemoteFactory(site: ConnectionConfig): RemoteClientFactory {
    return site.protocol === 'sftp' ? createSftpFactory(site) : createFtpFactory(site);
}

/** Absolute remote path of the site's web root (`/www`, or `/` when webRootPath is empty). */
export function remoteRootDir(site: Pick<SiteConfig, 'webRootPath'>): string {
    return path.posix.join('/', site.webRootPath);
}

/** Absolute remote path of a file placed at the web root (dump script, token, dump). */
export function remoteRootFile(site: SiteConfig, name: string): string {
    return path.posix.join(remoteRootDir(site), name);
}

/** Opens one connection and lists the web root, everything under one deadline. The connection is closed whatever happens; a client that connects after the deadline is closed too. */
export async function testConnection(
    config: ConnectionConfig,
    timeoutMs = 15_000,
): Promise<RemoteEntry[]> {
    const factory = createRemoteFactory(config);
    let timer: NodeJS.Timeout | undefined;
    let expired = false;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            expired = true;
            reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs);
    });

    let client: RemoteClient | null = null;
    try {
        client = await Promise.race([
            factory.create().then((created) => {
                if (expired) void created.close().catch(() => undefined);
                return created;
            }),
            deadline,
        ]);
        return await Promise.race([client.list(remoteRootDir(config)), deadline]);
    } finally {
        clearTimeout(timer);
        // `client` is set only when `create()` won the race, so this never double-closes.
        if (client) await client.close().catch(() => undefined);
    }
}
