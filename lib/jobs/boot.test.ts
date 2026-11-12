import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDatabase } from '../testing/db';

const { prisma, cleanup } = await setupTestDatabase();
const { encrypt } = await import('../crypto');
const { getSettings } = await import('../db');
const boot = await import('./boot');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-09-04T12:00:00Z');

async function createSite(domain: string): Promise<number> {
    const site = await prisma.site.create({
        data: {
            domain,
            repo: domain.replace(/\./g, '-'),
            repoUrl: `https://github.com/acme/${domain}.git`,
            host: 'ftp.example.com',
            port: 21,
            username: 'user',
            passwordEnc: encrypt('secret'),
        },
    });
    return site.id;
}

/** One row per status, queued `ageDays` ago. */
async function createBackup(siteId: number, status: string, ageDays: number): Promise<number> {
    const backup = await prisma.job.create({
        data: { siteId, status, queuedAt: new Date(now.getTime() - ageDays * DAY) },
    });
    return backup.id;
}

async function ids(siteId?: number): Promise<number[]> {
    const rows = await prisma.job.findMany({
        where: siteId ? { siteId } : {},
        orderBy: { id: 'asc' },
        select: { id: true },
    });
    return rows.map((r) => r.id);
}

afterAll(cleanup);

beforeEach(async () => {
    await prisma.job.deleteMany();
    await prisma.site.deleteMany();
    await getSettings();
    await prisma.settings.update({ where: { id: 1 }, data: { retentionDays: 30 } });
});

describe('checkEnvironment', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('throws in production when a secret is missing', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('SESSION_SECRET', '');
        expect(() => boot.checkEnvironment()).toThrow('SESSION_SECRET');
    });

    it('only warns outside production', () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('SESSION_SECRET', '');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => boot.checkEnvironment()).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('SESSION_SECRET'));
        warn.mockRestore();
    });

    it('rejects a malformed encryption key even when set', () => {
        vi.stubEnv('SESSION_SECRET', 'x');
        vi.stubEnv('ENCRYPTION_KEY', 'not-hex');
        expect(() => boot.checkEnvironment()).toThrow('ENCRYPTION_KEY');
    });
});

describe('sweepInterruptedJobs', () => {
    it('fails the rows left pending or running, leaves the others alone', async () => {
        const site = await createSite('a.example.com');
        const pending = await createBackup(site, 'pending', 0);
        const running = await createBackup(site, 'running', 0);
        const success = await createBackup(site, 'success', 0);

        expect(await boot.sweepInterruptedJobs()).toEqual(['a.example.com', 'a.example.com']);
        expect(await boot.sweepInterruptedJobs()).toEqual([]);

        for (const id of [pending, running]) {
            const row = await prisma.job.findUniqueOrThrow({ where: { id } });
            expect(row).toMatchObject({
                status: 'error',
                errorMessage: 'Interrupted by server restart',
            });
            expect(row.finishedAt).not.toBeNull();
        }
        const untouched = await prisma.job.findUniqueOrThrow({ where: { id: success } });
        expect(untouched).toMatchObject({ status: 'success', errorMessage: null });
    });
});

describe('boot', () => {
    afterEach(async () => {
        await boot.shutdown();
        vi.unstubAllEnvs();
    });

    it('sweeps once per process: a second call leaves live rows alone', async () => {
        vi.stubEnv('SESSION_SECRET', 'x');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const site = await createSite('a.example.com');

        const orphan = await createBackup(site, 'running', 0);
        await boot.boot();
        expect((await prisma.job.findUniqueOrThrow({ where: { id: orphan } })).status).toBe(
            'error',
        );

        const live = await createBackup(site, 'running', 0);
        await boot.boot();
        expect((await prisma.job.findUniqueOrThrow({ where: { id: live } })).status).toBe(
            'running',
        );

        warn.mockRestore();
        log.mockRestore();
    });
});

describe('pruneJobs', () => {
    it('deletes rows past the retention, keeping the last 5 per site and active rows', async () => {
        const a = await createSite('a.example.com');
        const b = await createSite('b.example.com');

        // Site A: 8 old rows (oldest first) and 1 recent one → the 5 most recent stay.
        const oldA = [];
        for (let i = 8; i >= 1; i--) oldA.push(await createBackup(a, 'success', 30 + i));
        const recentA = await createBackup(a, 'success', 1);

        // Site B: only old rows, one of them still running → all of them stay.
        const oldB = [await createBackup(b, 'error', 100), await createBackup(b, 'success', 90)];
        const runningB = await createBackup(b, 'running', 80);

        expect(await boot.pruneJobs(now)).toBe(4);

        expect(await ids(a)).toEqual([...oldA.slice(4), recentA]);
        expect(await ids(b)).toEqual([...oldB, runningB]);
    });

    it('keeps an old active row while deleting old finished ones beyond the last 5', async () => {
        const a = await createSite('a.example.com');
        const rows = [];
        for (let i = 7; i >= 1; i--) rows.push(await createBackup(a, 'success', 40 + i));
        const stuck = await createBackup(a, 'pending', 60);

        expect(await boot.pruneJobs(now)).toBe(3);
        expect(await ids(a)).toEqual([...rows.slice(3), stuck]);
    });

    it('honours Settings.retentionDays', async () => {
        const a = await createSite('a.example.com');
        // Oldest first, 15 to 10 days: only the oldest falls outside the last 5.
        for (let i = 5; i >= 0; i--) await createBackup(a, 'success', 10 + i);
        expect(await boot.pruneJobs(now)).toBe(0);

        await prisma.settings.update({ where: { id: 1 }, data: { retentionDays: 12 } });
        expect(await boot.pruneJobs(now)).toBe(1);
    });
});
