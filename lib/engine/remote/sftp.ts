import path from 'node:path';
import SftpClient from 'ssh2-sftp-client';
import type { ConnectionConfig } from '../types';
import type { RemoteClient, RemoteClientFactory, RemoteEntry } from './client';

const READY_TIMEOUT_MS = 30_000;
const KEEPALIVE_INTERVAL_MS = 10_000;
/**
 * Separate SSH sessions rather than parallel requests on one: ssh2-sftp-client documents
 * that a single client is not safe for concurrent operations. Three sessions stay under
 * the connection limits of shared hosts.
 */
const POOL_SIZE = 3;

export function createSftpFactory(site: ConnectionConfig): RemoteClientFactory {
    return {
        poolSize: POOL_SIZE,
        async create() {
            const client = new SftpClient();
            try {
                await client.connect({
                    host: site.host,
                    port: site.port,
                    username: site.username,
                    password: site.password,
                    readyTimeout: READY_TIMEOUT_MS,
                    keepaliveInterval: KEEPALIVE_INTERVAL_MS,
                    keepaliveCountMax: 3,
                });
            } catch (error) {
                throw new Error(
                    `SFTP connection to ${site.host}:${site.port} failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            return new SftpRemoteClient(client, await client.realPath('.'));
        },
    };
}

/**
 * Engine paths are absolute under the login directory (`/www/...`), the FTP convention. An SSH login lands in a real home, so every path is resolved under it here. A chrooted SFTP account has `/` as home and is unaffected.
 */
class SftpRemoteClient implements RemoteClient {
    constructor(
        private readonly client: SftpClient,
        private readonly home: string,
    ) {}

    private real(enginePath: string): string {
        return path.posix.join(this.home, enginePath);
    }

    async list(dir: string): Promise<RemoteEntry[]> {
        const items = await this.client.list(this.real(dir));
        const entries: RemoteEntry[] = [];
        for (const item of items) {
            // 'l' (symlink) is downloaded like a file: fastGet follows the link.
            if (item.type !== 'd' && item.type !== '-' && item.type !== 'l') continue;
            entries.push({
                path: dir === '/' ? `/${item.name}` : `${dir}/${item.name}`,
                type: item.type === 'd' ? 'dir' : 'file',
                size: item.size,
                // modifyTime is already in milliseconds.
                mtime: item.modifyTime ? new Date(item.modifyTime) : null,
            });
        }
        return entries;
    }

    async download(remotePath: string, localPath: string): Promise<void> {
        await this.client.fastGet(this.real(remotePath), localPath);
    }

    async read(remotePath: string): Promise<Buffer> {
        // Without a destination, `get` resolves with the content.
        const content = await this.client.get(this.real(remotePath));
        if (!Buffer.isBuffer(content)) throw new Error(`Could not read ${remotePath} into memory`);
        return content;
    }

    async upload(content: Buffer, remotePath: string): Promise<void> {
        await this.client.put(content, this.real(remotePath));
    }

    async remove(remotePath: string): Promise<void> {
        await this.client.delete(this.real(remotePath));
    }

    async close(): Promise<void> {
        await this.client.end();
    }
}
