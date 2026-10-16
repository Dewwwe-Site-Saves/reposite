import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger';
import { commitAndTag, ensureRepo, formatTag, headSha, push, type GitContext } from './git';

let workDir: string;
let bareRepo: string;
let ctx: GitContext;
const log = createLogger('[test]');
const savedEnv: Record<string, string | undefined> = {};

function bareGit(...args: string[]): string {
    return execFileSync('git', ['--git-dir', bareRepo, ...args], { encoding: 'utf8' }).trim();
}

beforeAll(() => {
    // Isolate from the developer's global config (default branch, credential helpers).
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
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reposite-git-'));
    bareRepo = path.join(workDir, 'remote.git');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', bareRepo]);
    ctx = {
        cwd: path.join(workDir, 'files', 'site'),
        name: 'Reposite',
        email: 'backup@example.com',
        token: null,
    };
});

afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe('formatTag', () => {
    it('formats in UTC as YYYYMMDD-HHmmss', () => {
        expect(formatTag(new Date('2026-09-03T21:05:09Z'))).toBe('20260903-210509');
    });
});

describe('ensureRepo / commitAndTag / push', () => {
    it('clones an empty remote, commits, tags and pushes', async () => {
        await ensureRepo(ctx, bareRepo, log);
        expect(fs.existsSync(path.join(ctx.cwd, '.git'))).toBe(true);

        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'CREATE TABLE t (id int);');
        const result = await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        expect(result.tag).toBe('20260903-210509');
        expect(result.commitSha).toMatch(/^[0-9a-f]{7,}$/);

        await push(ctx, result.tag, log);
        expect(bareGit('tag')).toBe('20260903-210509');
        expect(bareGit('rev-parse', '--short', 'main')).toBe(result.commitSha);
    });

    it('creates neither commit nor tag when the tree is clean', async () => {
        await ensureRepo(ctx, bareRepo, log);
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'x');
        const first = await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        const second = await commitAndTag(ctx, 'Backup 2', '20260903-210510', log);
        expect(second.tag).toBeNull();
        expect(second.commitSha).toBe(first.commitSha);
        await push(ctx, null, log);
        expect(bareGit('tag')).toBe('');
        expect(bareGit('rev-parse', '--short', 'main')).toBe(first.commitSha);
    });

    it('suffixes the tag when the name is already taken', async () => {
        await ensureRepo(ctx, bareRepo, log);
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'v1');
        await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'v2');
        const second = await commitAndTag(ctx, 'Backup 2', '20260903-210509', log);
        expect(second.tag).toBe('20260903-210509-2');
    });

    it('resets an existing clone to the remote branch and drops local leftovers', async () => {
        await ensureRepo(ctx, bareRepo, log);
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'v1');
        const { tag } = await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        await push(ctx, tag, log);

        // Simulate an interrupted run and a stale remote URL.
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'dirty');
        execFileSync('git', [
            '-C',
            ctx.cwd,
            'remote',
            'set-url',
            'origin',
            'https://x-access-token:secret@example.com/r.git',
        ]);

        await ensureRepo(ctx, bareRepo, log);
        expect(fs.readFileSync(path.join(ctx.cwd, 'db.sql'), 'utf8')).toBe('v1');
        expect(
            execFileSync('git', ['-C', ctx.cwd, 'remote', 'get-url', 'origin'], {
                encoding: 'utf8',
            }).trim(),
        ).toBe(bareRepo);
        expect(
            execFileSync('git', ['-C', ctx.cwd, 'branch', '--show-current'], {
                encoding: 'utf8',
            }).trim(),
        ).toBe('main');
    });

    // Reproduces a production failure: "The following untracked working tree files would be
    // overwritten by checkout: db.sql". The dump of an interrupted run stayed untracked while the
    // remote branch had since committed a file of the same name.
    it('drops an untracked leftover that the incoming branch also carries', async () => {
        await ensureRepo(ctx, bareRepo, log);
        fs.writeFileSync(path.join(ctx.cwd, 'www.txt'), 'site');
        const first = await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        await push(ctx, first.tag, log);

        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'from the remote');
        const second = await commitAndTag(ctx, 'Backup 2', '20260903-210510', log);
        await push(ctx, second.tag, log);

        // Local branch back to a commit without db.sql, and an untracked dump left in the tree.
        execFileSync('git', ['-C', ctx.cwd, 'reset', '--hard', 'HEAD~1']);
        fs.writeFileSync(path.join(ctx.cwd, 'db.sql'), 'leftover');

        await ensureRepo(ctx, bareRepo, log);

        expect(fs.readFileSync(path.join(ctx.cwd, 'db.sql'), 'utf8')).toBe('from the remote');
    });

    it('keeps the files the clone ignores, which are never committed', async () => {
        await ensureRepo(ctx, bareRepo, log);
        fs.writeFileSync(path.join(ctx.cwd, '.gitignore'), '*.mmdb\n');
        const { tag } = await commitAndTag(ctx, 'Backup 1', '20260903-210509', log);
        await push(ctx, tag, log);

        // Too large for GitHub, downloaded on every run and deliberately left out of the commits.
        fs.writeFileSync(path.join(ctx.cwd, 'geo.mmdb'), 'big');

        await ensureRepo(ctx, bareRepo, log);

        expect(fs.existsSync(path.join(ctx.cwd, 'geo.mmdb'))).toBe(true);
    });

    it('re-clones when the folder exists without .git', async () => {
        fs.mkdirSync(ctx.cwd, { recursive: true });
        fs.writeFileSync(path.join(ctx.cwd, 'junk.txt'), 'x');
        await ensureRepo(ctx, bareRepo, log);
        expect(fs.existsSync(path.join(ctx.cwd, '.git'))).toBe(true);
        expect(fs.existsSync(path.join(ctx.cwd, 'junk.txt'))).toBe(false);
    });

    it('reports a failing command without the command line or the token', async () => {
        ctx.token = 'ghp_secret_token';
        await expect(ensureRepo(ctx, path.join(workDir, 'missing.git'), log)).rejects.toMatchObject(
            { name: 'GitError' },
        );
        await expect(ensureRepo(ctx, path.join(workDir, 'missing.git'), log)).rejects.not.toThrow(
            /ghp_secret_token|credential\.helper/,
        );
    });

    it('returns null for headSha on an unborn branch', async () => {
        await ensureRepo(ctx, bareRepo, log);
        expect(await headSha(ctx)).toBeNull();
    });
});
