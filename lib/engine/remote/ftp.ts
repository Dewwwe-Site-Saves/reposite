import { Readable, Writable } from 'node:stream';
import { Client, enterPassiveModeIPv4 } from 'basic-ftp';
import type { ConnectionConfig } from '../types';
import type { RemoteClient, RemoteClientFactory, RemoteEntry } from './client';

const TIMEOUT_MS = 30_000;
const POOL_SIZE = 5;

export function createFtpFactory(site: ConnectionConfig): RemoteClientFactory {
    return {
        poolSize: POOL_SIZE,
        async create() {
            const client = new Client(TIMEOUT_MS);
            client.prepareTransfer = enterPassiveModeIPv4;
            try {
                await client.access({
                    host: site.host,
                    port: site.port,
                    user: site.username,
                    password: site.password,
                });
            } catch (error) {
                client.close();
                throw new Error(
                    `FTP connection to ${site.host}:${site.port} failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            return new FtpClient(client);
        },
    };
}

class FtpClient implements RemoteClient {
    constructor(private readonly client: Client) {}

    async list(dir: string): Promise<RemoteEntry[]> {
        const items = await this.client.list(dir);
        const entries: RemoteEntry[] = [];
        for (const item of items) {
            // Symbolic links are followed by RETR, so they are downloaded like files.
            if (!item.isDirectory && !item.isFile && !item.isSymbolicLink) continue;
            entries.push({
                path: dir === '/' ? `/${item.name}` : `${dir}/${item.name}`,
                type: item.isDirectory ? 'dir' : 'file',
                size: item.size,
                mtime: item.modifiedAt ?? null,
            });
        }
        return entries;
    }

    async download(remotePath: string, localPath: string): Promise<void> {
        await this.client.downloadTo(localPath, remotePath);
    }

    async read(remotePath: string): Promise<Buffer> {
        const chunks: Buffer[] = [];
        const sink = new Writable({
            write(chunk: Buffer, _encoding, callback) {
                chunks.push(chunk);
                callback();
            },
        });
        await this.client.downloadTo(sink, remotePath);
        return Buffer.concat(chunks);
    }

    async upload(content: Buffer, remotePath: string): Promise<void> {
        await this.client.uploadFrom(Readable.from(content), remotePath);
    }

    async remove(remotePath: string): Promise<void> {
        await this.client.remove(remotePath);
    }

    async close(): Promise<void> {
        this.client.close();
    }
}
