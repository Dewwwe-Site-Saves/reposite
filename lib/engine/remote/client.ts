/**
 * Protocol-agnostic view of the site's file server. `sync.ts` and `dump.ts` only ever talk
 * to these interfaces; `ftp.ts` and `sftp.ts` implement them.
 *
 * Paths are absolute POSIX paths on the remote (`/www/wp-config.php`).
 */

export interface RemoteEntry {
    path: string;
    type: 'file' | 'dir';
    size: number;
    /** Null when the server does not report modification times (FTP without MLSD). */
    mtime: Date | null;
}

export interface RemoteClient {
    list(dir: string): Promise<RemoteEntry[]>;
    download(remotePath: string, localPath: string): Promise<void>;
    /** Whole file in memory, for the few small files the inventory parses. The caller checks the size in a listing first. */
    read(remotePath: string): Promise<Buffer>;
    upload(content: Buffer, remotePath: string): Promise<void>;
    remove(remotePath: string): Promise<void>;
    close(): Promise<void>;
}

export interface RemoteClientFactory {
    /** Opens one connection. */
    create(): Promise<RemoteClient>;
    /**
     * Connections opened in parallel for scanning and downloading. One worker per
     * connection: no client is ever used by two operations at the same time.
     */
    poolSize: number;
}
