import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BackupCancelledError, errorMessage, throwIfAborted } from './cancel';
import type { RemoteClient } from './remote/client';
import { remoteRootFile } from './remote';
import { DUMP_SCRIPT_NAME, TOKEN_FILE_NAME, isSafePath } from './sync';
import type { Logger, SiteConfig } from './types';

/** Stable name inside the clone, so the dump has a diffable history. */
export const DUMP_FILE_NAME = 'db.sql';

/** The PHP endpoint, read at each run so an edit needs no restart. Copied by the Docker image. */
export const DUMP_SCRIPT_PATH = path.join(process.cwd(), 'helpers', 'backup-wp.php');

const HTTP_TIMEOUT_MS = 10 * 60_000;
const MIN_DUMP_BYTES = 1024;
const RESPONSE_SNIPPET = 500;
/** Window read at the head of the dump: a MariaDB header and its SET block push the first table past the first kilobyte. */
const DUMP_HEAD_BYTES = 8192;
/** `mysqldump` on MariaDB is `mariadb-dump`, whose header says "MariaDB dump" and names neither binary. */
const SQL_MARKERS = [
    'MySQL dump',
    'MariaDB dump',
    'mysqldump',
    'mariadb-dump',
    'DROP TABLE',
    'CREATE TABLE',
    'INSERT INTO',
];
const REMOTE_DUMP_NAME = /^db_[A-Za-z0-9_-]+\.sql$/;

export class DumpError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DumpError';
    }
}

export interface DumpResult {
    sizeBytes: number;
}

/**
 * Uploads the token hash and the PHP script, triggers the dump over HTTPS, downloads it to
 * `localPath` and validates it. The remote dump, script and token file are removed before
 * returning, whatever happened: the exposure window on the web root is the dump itself.
 */
export async function dumpDatabase(
    site: SiteConfig,
    client: RemoteClient,
    localPath: string,
    log: Logger,
    signal?: AbortSignal,
): Promise<DumpResult> {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const script = fs.readFileSync(DUMP_SCRIPT_PATH);
    let remoteDump: string | null = null;

    try {
        log.info('Uploading dump script...');
        await client.upload(Buffer.from(tokenHash), remoteRootFile(site, TOKEN_FILE_NAME));
        await client.upload(script, remoteRootFile(site, DUMP_SCRIPT_NAME));
        throwIfAborted(signal);

        log.info('Triggering database dump...');
        const fileName = await triggerDump(site.domain, token, signal);
        remoteDump = remoteRootFile(site, fileName);

        log.info('Downloading dump...');
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        await client.download(remoteDump, localPath);
        const sizeBytes = validateDump(localPath);
        log.info(`Dump validated: ${fileName} (${Math.round(sizeBytes / 1024)} KB)`);
        return { sizeBytes };
    } finally {
        // The script deletes itself and the token file once the token is accepted; these
        // removals only matter when the HTTP call never reached it.
        for (const remotePath of [
            remoteDump,
            remoteRootFile(site, DUMP_SCRIPT_NAME),
            remoteRootFile(site, TOKEN_FILE_NAME),
        ]) {
            if (remotePath) await client.remove(remotePath).catch(() => undefined);
        }
    }
}

interface DumpResponse {
    status?: string;
    file?: string;
    code?: string;
    message?: string;
}

/** Calls the endpoint and returns the remote dump file name. */
async function triggerDump(domain: string, token: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(`https://${domain}/${DUMP_SCRIPT_NAME}`, {
            method: 'GET',
            headers: { 'X-Backup-Token': token, 'User-Agent': 'reposite' },
            redirect: 'manual',
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
    } catch (error) {
        if (signal?.aborted) throw new BackupCancelledError();
        if (error instanceof Error && error.name === 'TimeoutError')
            throw new DumpError(`Dump request timed out after ${HTTP_TIMEOUT_MS / 60_000} min`);
        throw new DumpError(`Dump request failed: ${errorMessage(error)}`);
    }

    if (response.status >= 300 && response.status < 400) {
        throw new DumpError(
            `https://${domain} redirected to ${response.headers.get('location') ?? 'another URL'}; set the site domain to its canonical host`,
        );
    }

    const text = await response.text();
    let payload: DumpResponse | null = null;
    try {
        payload = JSON.parse(text) as DumpResponse;
    } catch {
        throw new DumpError(
            `Dump endpoint answered HTTP ${response.status} with a non-JSON body: ${text.slice(0, RESPONSE_SNIPPET)}`,
        );
    }
    if (payload?.status !== 'ok' || typeof payload.file !== 'string') {
        const detail = [payload?.code, payload?.message].filter(Boolean).join(': ');
        throw new DumpError(`Dump failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }
    if (!REMOTE_DUMP_NAME.test(payload.file) || !isSafePath(payload.file)) {
        throw new DumpError(
            `Dump endpoint returned an unexpected file name: ${payload.file.slice(0, 100)}`,
        );
    }
    return payload.file;
}

/** Size check plus a look at the first bytes: a PHP error page must never become db.sql. */
function validateDump(localPath: string): number {
    const stat = fs.statSync(localPath, { throwIfNoEntry: false });
    if (!stat || stat.size < MIN_DUMP_BYTES) {
        throw new DumpError(`Downloaded dump is missing or too small (${stat?.size ?? 0} bytes)`);
    }
    const fd = fs.openSync(localPath, 'r');
    const head = Buffer.alloc(DUMP_HEAD_BYTES);
    try {
        const read = fs.readSync(fd, head, 0, head.length, 0);
        const text = head.subarray(0, read).toString('utf8');
        if (!SQL_MARKERS.some((marker) => text.includes(marker))) {
            // The first line tells an error page from a dump an unknown tool wrote, without opening the file on the server.
            const firstLine = JSON.stringify(text.slice(0, 160).split('\n', 1)[0]);
            throw new DumpError(
                `Downloaded dump does not look like SQL, it starts with ${firstLine}`,
            );
        }
    } finally {
        fs.closeSync(fd);
    }
    return stat.size;
}
