import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runBackup } from './backup';
import type { LogEntry, SiteConfig } from './types';

// Remote clients are replaced by the in-memory server; git runs for real on a bare repo.
const { remoteRef } = vi.hoisted(() => ({ remoteRef: { current: null as unknown } }));
vi.mock('./remote', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./remote')>();
    return {
        ...actual,
        createRemoteFactory: () => (remoteRef.current as { factory(): unknown }).factory(),
    };
});

const { FakeRemote } = await import('./testing/fake-remote');

const SQL = `-- MySQL dump 10.13\nCREATE TABLE wp_options (id int);\n${'INSERT INTO wp_options VALUES (1);\n'.repeat(50)}`;
const github = {
    name: 'Reposite',
    email: 'backup@example.com',
    token: 'not-used-for-file-remotes',
};
const savedEnv: Record<string, string | undefined> = {};

let workDir: string;
let bareRepo: string;
let localRoot: string;
let remote: InstanceType<typeof FakeRemote>;
let site: SiteConfig;
let entries: LogEntry[];

function bareGit(...args: string[]): string {
    return execFileSync('git', ['--git-dir', bareRepo, ...args], { encoding: 'utf8' }).trim();
}

function stubDumpEndpoint(): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url === 'https://site.test/dewwwe-backup.php') {
                remote.put('/www/db_wp_0011223344556677.sql', SQL);
                return new Response(
                    JSON.stringify({ status: 'ok', file: 'db_wp_0011223344556677.sql' }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ message: 'unexpected call' }), { status: 500 });
        }),
    );
}

beforeAll(() => {
    for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'])
        savedEnv[key] = process.env[key];
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
});

afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reposite-run-'));
    bareRepo = path.join(workDir, 'remote.git');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bareRepo]);
    localRoot = path.join(workDir, 'files', 'site');
    remote = new FakeRemote();
    remoteRef.current = remote;
    remote.put('/www/index.php', '<?php');
    remote.put('/www/wp-config.php', 'config');
    remote.put('/www/wp-content/uploads/a.jpg', 'jpeg');
    site = {
        domain: 'site.test',
        repo: 'site',
        repoUrl: bareRepo,
        protocol: 'ftp',
        host: 'ftp.site.test',
        port: 21,
        username: 'u',
        password: 'p',
        webRootPath: 'www',
        spListItemId: null,
    };
    entries = [];
    stubDumpEndpoint();
});

afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(workDir, { recursive: true, force: true });
});

function run(overrides: Partial<Parameters<typeof runBackup>[3]> = {}) {
    return runBackup(site, github, null, {
        localRoot,
        triggerType: 'manual',
        fullDownload: false,
        skipGit: false,
        onLog: (e) => entries.push(e),
        ...overrides,
    });
}

describe('runBackup', () => {
    it('clones, dumps, syncs, commits, tags and pushes', async () => {
        const result = await run();
        expect(result.errorMessage).toBeNull();
        expect(result.status).toBe('success');
        expect(result.filesDownloaded).toBe(3);
        expect(result.dumpSizeBytes).toBe(SQL.length);
        expect(result.tag).toMatch(/^\d{8}-\d{6}$/);
        expect(result.commitSha).toMatch(/^[0-9a-f]{7,}$/);
        // Release creation is skipped for a non-GitHub remote: a warning, not a failure.
        expect(result.releaseUrl).toBeNull();
        expect(result.log).toContain('Release creation failed');

        expect(bareGit('tag')).toBe(result.tag);
        expect(bareGit('ls-tree', '--name-only', 'main')).toBe(
            ['.gitignore', 'db.sql', 'www'].join('\n'),
        );
        expect(fs.readFileSync(path.join(localRoot, 'db.sql'), 'utf8')).toBe(SQL);

        // Nothing of ours is left on the remote.
        expect([...remote.files.keys()].sort()).toEqual([
            '/www/index.php',
            '/www/wp-config.php',
            '/www/wp-content/uploads/a.jpg',
        ]);
    });

    it('creates no snapshot when nothing changed', async () => {
        const first = await run();
        const second = await run();
        expect(second.status).toBe('success');
        expect(second.filesDownloaded).toBe(0);
        expect(second.filesUnchanged).toBe(3);
        expect(second.tag).toBeNull();
        expect(second.commitSha).toBe(first.commitSha);
        expect(bareGit('tag')).toBe(first.tag);
    });

    it('removes leftovers and the legacy workflow before running', async () => {
        remote.put('/www/db_old_leftover.sql', 'x');
        remote.put('/www/dewwwe-backup.php', 'x');
        await run();
        fs.mkdirSync(path.join(localRoot, '.github', 'workflows'), { recursive: true });
        fs.writeFileSync(
            path.join(localRoot, '.github', 'workflows', 'auto-tagged-release.yml'),
            'legacy',
        );
        fs.writeFileSync(path.join(localRoot, 'www', 'db_legacy_123.sql'), 'legacy');
        execFileSync('git', ['-C', localRoot, 'add', '--all']);
        execFileSync('git', [
            '-C',
            localRoot,
            '-c',
            'user.name=t',
            '-c',
            'user.email=t@t',
            'commit',
            '--quiet',
            '-m',
            'legacy',
        ]);
        execFileSync('git', ['-C', localRoot, 'push', '--quiet', 'origin', 'HEAD']);

        const result = await run();
        expect(result.errorMessage).toBeNull();
        expect(result.status).toBe('success');
        expect(remote.removals).toContain('/www/db_old_leftover.sql');
        expect(remote.removals).toContain('/www/dewwwe-backup.php');
        expect(fs.existsSync(path.join(localRoot, '.github'))).toBe(false);
        expect(fs.existsSync(path.join(localRoot, 'www', 'db_legacy_123.sql'))).toBe(false);
        expect(bareGit('ls-tree', '--name-only', '-r', 'main')).not.toContain(
            'auto-tagged-release.yml',
        );
    });

    it('reconnects for the dump when the host drops the first connection', async () => {
        // The socket dies on the first command after login: every later call fails too.
        const dead = new Error('Client is closed because Server sent FIN packet unexpectedly');
        const deadClient = {
            list: async () => Promise.reject(dead),
            download: async () => Promise.reject(dead),
            upload: async () => Promise.reject(dead),
            remove: async () => Promise.reject(dead),
            close: async () => {},
        };
        const real = remote.factory();
        let created = 0;
        remoteRef.current = {
            factory: () => ({
                poolSize: real.poolSize,
                create: async () => (created++ === 0 ? deadClient : real.create()),
            }),
        };

        const result = await run();
        expect(result.errorMessage).toBeNull();
        expect(result.status).toBe('success');
        expect(result.dumpSizeBytes).toBe(SQL.length);
        expect(entries.map((e) => e.msg)).toContain('[site.test] Reconnecting for the dump...');
        expect(entries.filter((e) => e.level === 'warn').map((e) => e.msg)).toContain(
            `[site.test] Could not clean up leftovers: ${dead.message}`,
        );
    });

    it('skips git when asked', async () => {
        const result = await run({ skipGit: true });
        expect(result.status).toBe('success');
        expect(result.tag).toBeNull();
        expect(bareGit('rev-list', '--all', '--count')).toBe('0');
        expect(result.log).toContain('Skipping commit and push');
    });

    it('reports a dump failure as an error and pushes nothing', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            status: 'error',
                            code: 'mysqldump_failed',
                            message: 'boom',
                        }),
                        { status: 500 },
                    ),
            ),
        );
        const result = await run();
        expect(result.status).toBe('error');
        expect(result.errorMessage).toContain('mysqldump_failed');
        expect(bareGit('rev-list', '--all', '--count')).toBe('0');
        expect(remote.has('/www/dewwwe-backup.php')).toBe(false);
    });

    it('reports a cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        const result = await run({ signal: controller.signal });
        expect(result.status).toBe('cancelled');
        expect(result.errorMessage).toBe('Cancelled by user');
    });
});
