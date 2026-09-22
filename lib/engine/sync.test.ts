import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupCancelledError } from './cancel';
import { createLogger } from './logger';
import type { RemoteClientFactory } from './remote/client';
import {
    compileExcludes,
    deleteOrphans,
    isSafePath,
    planSync,
    scanRemote,
    syncFiles,
} from './sync';
import { FakeRemote } from './testing/fake-remote';

// ============ Fixtures ============

let localRoot: string;
let remote: FakeRemote;
const log = createLogger('[test]');

function writeLocal(relPath: string, content: string, mtime?: Date): void {
    const fullPath = path.join(localRoot, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    if (mtime) fs.utimesSync(fullPath, mtime, mtime);
}

function localFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else out.push(path.relative(localRoot, full));
        }
    };
    walk(localRoot);
    return out.sort();
}

beforeEach(() => {
    localRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reposite-sync-'));
    remote = new FakeRemote();
    remote.put('/www/index.php', '<?php');
    remote.put('/www/wp-config.php', 'config');
    remote.put('/www/wp-content/uploads/a.jpg', 'jpeg');
});

afterEach(() => {
    fs.rmSync(localRoot, { recursive: true, force: true });
});

// ============ Tests ============

describe('isSafePath', () => {
    it('accepts nested relative paths', () => {
        expect(isSafePath('www/wp-content/x.php')).toBe(true);
        expect(isSafePath('www/../www/x.php')).toBe(true);
    });

    it('rejects traversal and absolute paths', () => {
        expect(isSafePath('../etc/passwd')).toBe(false);
        expect(isSafePath('..')).toBe(false);
        expect(isSafePath('www/../../x')).toBe(false);
        expect(isSafePath('/etc/passwd')).toBe(false);
    });
});

describe('compileExcludes', () => {
    it('anchors patterns with a slash at the web root', () => {
        const excluded = compileExcludes(['wp-content/debug.log']);
        expect(excluded('wp-content/debug.log', false)).toBe(true);
        expect(excluded('wp-content/plugins/x/wp-content/debug.log', false)).toBe(false);
        expect(excluded('wp-content/debug.log.1', false)).toBe(false);
    });

    it('matches a bare name at any depth', () => {
        const excluded = compileExcludes(['error_log']);
        expect(excluded('error_log', false)).toBe(true);
        expect(excluded('wp-admin/includes/error_log', false)).toBe(true);
        expect(excluded('wp-admin/error_log.txt', false)).toBe(false);
    });

    it('restricts a trailing slash to directories and matches them exactly', () => {
        const excluded = compileExcludes(['wp-content/cache/']);
        expect(excluded('wp-content/cache', true)).toBe(true);
        expect(excluded('wp-content/cache', false)).toBe(false);
        expect(excluded('wp-content/cache-notes', true)).toBe(false);
        expect(excluded('wp-content/cache/page.html', false)).toBe(false);
    });

    it('expands * within one segment and escapes the rest', () => {
        const excluded = compileExcludes(['wp-content/temp-write-test-*', '*.mmdb']);
        expect(excluded('wp-content/temp-write-test-6a6ff4465a1ad0-99606319', false)).toBe(true);
        expect(excluded('wp-content/temp-write-test-x/y', false)).toBe(false);
        expect(excluded('wp-content/plugins/geo/GeoLite2.mmdb', false)).toBe(true);
        expect(excluded('wp-content/plugins/geo/GeoLite2ammdb', false)).toBe(false);
    });
});

describe('scanRemote', () => {
    it('skips excluded directories and files without listing them', async () => {
        remote.put('/www/wp-content/updraft/backup-uploads.zip', 'zip');
        remote.put('/www/wp-content/cache/page/index.html', 'html');
        remote.put('/www/wp-content/temp-write-test-6a6ff4465a1ad0-99606319', '');
        remote.put('/www/wp-content/debug.log', 'log');
        remote.put('/www/wp-includes/error_log', 'log');
        remote.put('/www/wp-content/uploads/cache-notes.txt', 'kept');
        remote.unlistable.add('/www/wp-content/cache');
        const result = await scanRemote([remote.client()], '/www', log);
        expect(result.listErrors).toBe(0);
        expect(result.files.map((f) => f.path).sort()).toEqual([
            '/www/index.php',
            '/www/wp-config.php',
            '/www/wp-content/uploads/a.jpg',
            '/www/wp-content/uploads/cache-notes.txt',
        ]);
    });

    it('lists every file recursively', async () => {
        const result = await scanRemote([remote.client(), remote.client()], '/www', log);
        expect(result.listErrors).toBe(0);
        expect(result.files.map((f) => f.path).sort()).toEqual([
            '/www/index.php',
            '/www/wp-config.php',
            '/www/wp-content/uploads/a.jpg',
        ]);
    });

    it('excludes backup artifacts at the web root only', async () => {
        remote.put('/www/dewwwe-backup.php', 'x');
        remote.put('/www/.dewwwe-backup-token', 'x');
        remote.put('/www/db_site_abc.sql', 'x');
        remote.put('/www/wp-content/db_plugin.sql', 'x');
        const result = await scanRemote([remote.client()], '/www', log);
        const paths = result.files.map((f) => f.path);
        expect(paths).not.toContain('/www/dewwwe-backup.php');
        expect(paths).not.toContain('/www/.dewwwe-backup-token');
        expect(paths).not.toContain('/www/db_site_abc.sql');
        expect(paths).toContain('/www/wp-content/db_plugin.sql');
    });

    it('counts unlistable directories instead of failing', async () => {
        remote.unlistable.add('/www/wp-content');
        const result = await scanRemote([remote.client()], '/www', log);
        expect(result.listErrors).toBe(1);
        expect(result.files).toHaveLength(2);
    });

    it('throws when cancelled', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(
            scanRemote([remote.client()], '/www', log, controller.signal),
        ).rejects.toBeInstanceOf(BackupCancelledError);
    });
});

describe('planSync', () => {
    it('downloads missing files and skips identical ones', async () => {
        const { files } = await scanRemote([remote.client()], '/www', log);
        const mtime = new Date('2026-01-01T00:00:00Z');
        writeLocal('www/index.php', '<?php', mtime);
        const plan = planSync(localRoot, files, 'incremental');
        expect(plan.toDownload.map((f) => f.path).sort()).toEqual([
            '/www/wp-config.php',
            '/www/wp-content/uploads/a.jpg',
        ]);
        expect(plan.unchanged).toBe(1);
        expect([...plan.remoteSet].sort()).toEqual([
            'www/index.php',
            'www/wp-config.php',
            'www/wp-content/uploads/a.jpg',
        ]);
    });

    it('downloads when the size differs', async () => {
        const { files } = await scanRemote([remote.client()], '/www', log);
        writeLocal('www/index.php', '<?php echo 1;', new Date('2026-01-01T00:00:00Z'));
        expect(planSync(localRoot, files, 'incremental').toDownload.map((f) => f.path)).toContain(
            '/www/index.php',
        );
    });

    it('downloads when the remote is newer beyond the tolerance', async () => {
        const { files } = await scanRemote([remote.client()], '/www', log);
        writeLocal('www/index.php', '<?php', new Date('2025-12-31T23:59:00Z'));
        expect(planSync(localRoot, files, 'incremental').toDownload.map((f) => f.path)).toContain(
            '/www/index.php',
        );
    });

    it('keeps a local file newer than the remote', async () => {
        const { files } = await scanRemote([remote.client()], '/www', log);
        writeLocal('www/index.php', '<?php', new Date('2026-02-01T00:00:00Z'));
        expect(
            planSync(localRoot, files, 'incremental').toDownload.map((f) => f.path),
        ).not.toContain('/www/index.php');
    });

    it('downloads everything in full mode', async () => {
        const { files } = await scanRemote([remote.client()], '/www', log);
        writeLocal('www/index.php', '<?php', new Date('2026-01-01T00:00:00Z'));
        expect(planSync(localRoot, files, 'full').toDownload).toHaveLength(3);
    });
});

describe('deleteOrphans', () => {
    it('removes files absent from the remote set and empty directories, keeps preserved entries', () => {
        writeLocal('www/index.php', 'x');
        writeLocal('www/old/gone.php', 'x');
        writeLocal('.git/HEAD', 'ref');
        writeLocal('.gitignore', '*.mmdb');
        writeLocal('README.md', 'readme');
        writeLocal('db.sql', 'dump');
        writeLocal('.github/workflows/auto-tagged-release.yml', 'legacy');
        const deleted = deleteOrphans(localRoot, new Set(['www/index.php']));
        expect(deleted).toBe(2);
        expect(localFiles()).toEqual([
            '.git/HEAD',
            '.gitignore',
            'README.md',
            'db.sql',
            'www/index.php',
        ]);
        expect(fs.existsSync(path.join(localRoot, 'www/old'))).toBe(false);
    });

    it('clears everything but preserved entries with an empty set', () => {
        writeLocal('www/index.php', 'x');
        writeLocal('.git/HEAD', 'ref');
        expect(deleteOrphans(localRoot, new Set())).toBe(1);
        expect(localFiles()).toEqual(['.git/HEAD']);
    });
});

describe('syncFiles', () => {
    it('performs an incremental sync with orphan deletion', async () => {
        writeLocal('www/stale.php', 'x');
        const stats = await syncFiles(remote.factory(), localRoot, '/www', {
            mode: 'incremental',
            log,
        });
        expect(stats).toEqual({
            scanned: 3,
            downloaded: 3,
            failed: 0,
            unchanged: 0,
            deleted: 1,
            listErrors: 0,
        });
        expect(localFiles()).toEqual([
            'www/index.php',
            'www/wp-config.php',
            'www/wp-content/uploads/a.jpg',
        ]);
        expect(fs.readFileSync(path.join(localRoot, 'www/wp-config.php'), 'utf8')).toBe('config');
    });

    it('prunes a local file under an excluded path and honours a custom list', async () => {
        remote.put('/www/wp-content/updraft/backup-uploads.zip', 'zip');
        writeLocal('www/wp-content/updraft/backup-uploads.zip', 'zip');
        const stats = await syncFiles(remote.factory(), localRoot, '/www', {
            mode: 'incremental',
            log,
        });
        expect(stats.scanned).toBe(3);
        expect(stats.deleted).toBe(1);
        expect(localFiles()).not.toContain('www/wp-content/updraft/backup-uploads.zip');

        const custom = await syncFiles(remote.factory(), localRoot, '/www', {
            mode: 'incremental',
            log,
            excludes: ['wp-content/uploads/'],
        });
        expect(custom.scanned).toBe(3);
        expect(localFiles()).toEqual([
            'www/index.php',
            'www/wp-config.php',
            'www/wp-content/updraft/backup-uploads.zip',
        ]);
    });

    it('skips orphan deletion when a directory could not be listed', async () => {
        writeLocal('www/stale.php', 'x');
        remote.unlistable.add('/www/wp-content');
        const stats = await syncFiles(remote.factory(), localRoot, '/www', {
            mode: 'incremental',
            log,
        });
        expect(stats.listErrors).toBe(1);
        expect(stats.deleted).toBe(0);
        expect(localFiles()).toContain('www/stale.php');
    });

    it('fails when nothing could be listed', async () => {
        remote.unlistable.add('/www');
        await expect(
            syncFiles(remote.factory(), localRoot, '/www', { mode: 'incremental', log }),
        ).rejects.toThrow('Could not list any remote file');
    });

    it('counts failed downloads without aborting', async () => {
        remote.undownloadable.add('/www/index.php');
        const stats = await syncFiles(remote.factory(), localRoot, '/www', {
            mode: 'incremental',
            log,
        });
        expect(stats.downloaded).toBe(2);
        expect(stats.failed).toBe(1);
    });

    it('wipes the local tree before a full download', async () => {
        writeLocal('www/stale.php', 'x');
        writeLocal('.git/HEAD', 'ref');
        const stats = await syncFiles(remote.factory(), localRoot, '/www', { mode: 'full', log });
        expect(stats.deleted).toBe(1);
        expect(stats.downloaded).toBe(3);
        expect(localFiles()).toEqual([
            '.git/HEAD',
            'www/index.php',
            'www/wp-config.php',
            'www/wp-content/uploads/a.jpg',
        ]);
    });

    it('refuses a full download with a partial listing', async () => {
        writeLocal('www/keep.php', 'x');
        remote.unlistable.add('/www/wp-content');
        await expect(
            syncFiles(remote.factory(), localRoot, '/www', { mode: 'full', log }),
        ).rejects.toThrow('Full download aborted');
        expect(localFiles()).toContain('www/keep.php');
    });

    it('closes every connection, even when the sync fails', async () => {
        let closed = 0;
        const factory: RemoteClientFactory = {
            poolSize: 2,
            create: async () => {
                const client = remote.client();
                return {
                    ...client,
                    close: async () => {
                        closed++;
                    },
                };
            },
        };
        remote.unlistable.add('/www');
        await expect(
            syncFiles(factory, localRoot, '/www', { mode: 'incremental', log }),
        ).rejects.toThrow();
        expect(closed).toBe(2);
    });
});
