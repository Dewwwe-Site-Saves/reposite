import fs from 'node:fs';
import path from 'node:path';
import type { RemoteClient, RemoteClientFactory, RemoteEntry } from '../remote/client';

interface FakeFile {
    content: Buffer;
    mtime: Date;
}

/** In-memory file server implementing RemoteClient, for engine tests. */
export class FakeRemote {
    readonly files = new Map<string, FakeFile>();
    readonly unlistable = new Set<string>();
    readonly undownloadable = new Set<string>();
    readonly reads: string[] = [];
    readonly uploads: string[] = [];
    readonly removals: string[] = [];

    put(
        remotePath: string,
        content: string | Buffer,
        mtime = new Date('2026-01-01T00:00:00Z'),
    ): void {
        this.files.set(remotePath, { content: Buffer.from(content), mtime });
    }

    has(remotePath: string): boolean {
        return this.files.has(remotePath);
    }

    factory(poolSize = 2): RemoteClientFactory {
        return { poolSize, create: async () => this.client() };
    }

    client(): RemoteClient {
        return {
            list: async (dir) => {
                if (this.unlistable.has(dir)) throw new Error('Permission denied');
                const prefix = dir === '/' ? '/' : `${dir}/`;
                const entries = new Map<string, RemoteEntry>();
                for (const [filePath, file] of this.files) {
                    if (!filePath.startsWith(prefix)) continue;
                    const [head, ...tail] = filePath.slice(prefix.length).split('/');
                    const entryPath = `${prefix}${head}`;
                    if (tail.length === 0) {
                        entries.set(entryPath, {
                            path: entryPath,
                            type: 'file',
                            size: file.content.length,
                            mtime: file.mtime,
                        });
                    } else if (!entries.has(entryPath)) {
                        entries.set(entryPath, {
                            path: entryPath,
                            type: 'dir',
                            size: 0,
                            mtime: null,
                        });
                    }
                }
                return [...entries.values()];
            },
            download: async (remotePath, localPath) => {
                if (this.undownloadable.has(remotePath)) throw new Error('Transfer failed');
                const file = this.files.get(remotePath);
                if (!file) throw new Error('No such file');
                fs.mkdirSync(path.dirname(localPath), { recursive: true });
                fs.writeFileSync(localPath, file.content);
                fs.utimesSync(localPath, file.mtime, file.mtime);
            },
            read: async (remotePath) => {
                this.reads.push(remotePath);
                if (this.undownloadable.has(remotePath)) throw new Error('Transfer failed');
                const file = this.files.get(remotePath);
                if (!file) throw new Error('No such file');
                return file.content;
            },
            upload: async (content, remotePath) => {
                this.uploads.push(remotePath);
                this.put(remotePath, content, new Date());
            },
            remove: async (remotePath) => {
                this.removals.push(remotePath);
                if (!this.files.delete(remotePath)) throw new Error('No such file');
            },
            close: async () => {},
        };
    }
}
