import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDatabase } from '../testing/db';
import { FakeGrist } from './testing/fake-grist';

// Prisma, the crypto helpers, the settings loader and the queue's emitter run for real on a throwaway database; Grist is the in-memory document.
const { prisma, cleanup } = await setupTestDatabase();
const { encrypt } = await import('../crypto');
const queue = await import('../jobs/queue');
const push = await import('./push');

const SITE_COLUMNS = [
    'Title',
    'Url',
    'Domain',
    'CMS',
    'CmsVersion',
    'InventoryAt',
    'LastBackupAt',
    'LastBackupStatus',
    'LastBackupUrl',
    'RepositeUrl',
];
const COMPONENT_COLUMNS = ['Site', 'Type', 'Slug', 'Name', 'Version', 'Status', 'RemovedAt'];

const GRIST = {
    gristUrl: 'https://grist.example.com',
    gristApiKeyEnc: encrypt('secret-key'),
    gristDocId: 'doc1',
    gristSitesTable: 'Sites',
    gristComponentsTable: 'Components',
};

function document(): FakeGrist {
    return new FakeGrist()
        .table('Sites', SITE_COLUMNS)
        .table('Components', COMPONENT_COLUMNS)
        .install();
}

async function createSite(domain = 'site.test'): Promise<number> {
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

function createJob(siteId: number, data: Record<string, unknown>): Promise<{ id: number }> {
    return prisma.job.create({ data: { siteId, ...data }, select: { id: true } });
}

beforeEach(async () => {
    await prisma.site.deleteMany();
    await prisma.settings.upsert({
        where: { id: 1 },
        update: GRIST,
        create: { id: 1, ...GRIST },
    });
    vi.stubEnv('APP_URL', 'https://reposite.example.com/');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

afterAll(cleanup);

describe('pushSite', () => {
    it('pushes the state of the site, each backup fact from the run that carries it', async () => {
        const grist = document();
        const siteId = await createSite();
        const inventoryAt = new Date('2026-11-13T04:00:10Z');
        await prisma.site.update({
            where: { id: siteId },
            data: { cms: 'wordpress', cmsVersion: '7.1.4', inventoryAt },
        });
        await prisma.siteComponent.create({
            data: { siteId, type: 'plugin', slug: 'akismet', name: 'Akismet', version: '5.3' },
        });
        const succeededAt = new Date('2026-11-01T02:03:00Z');
        await createJob(siteId, {
            status: 'success',
            finishedAt: succeededAt,
            releaseUrl: 'https://github.com/acme/site/releases/tag/20261101-020300',
        });
        // Nothing to commit: a success without a Release.
        const unchangedAt = new Date('2026-11-08T02:01:00Z');
        await createJob(siteId, { status: 'success', finishedAt: unchangedAt });
        await createJob(siteId, { status: 'error', finishedAt: new Date('2026-11-15T02:00:30Z') });
        await createJob(siteId, { kind: 'inventory', status: 'success', finishedAt: inventoryAt });
        await createJob(siteId, { status: 'running' });

        const result = await push.pushSite(siteId);

        expect(result).toMatchObject({ siteId, domain: 'site.test', error: null });
        expect(grist.rows('Sites')[0]!.fields).toEqual({
            Domain: 'site.test',
            Title: 'site.test',
            Url: 'https://site.test',
            CMS: 'WordPress',
            CmsVersion: '7.1.4',
            InventoryAt: inventoryAt.getTime() / 1000,
            LastBackupAt: unchangedAt.getTime() / 1000,
            LastBackupStatus: 'error',
            LastBackupUrl: 'https://github.com/acme/site/releases/tag/20261101-020300',
            RepositeUrl: `https://reposite.example.com/sites/${siteId}`,
        });
        expect(grist.rows('Components').map((row) => row.fields.Slug)).toEqual([
            'wordpress',
            'akismet',
        ]);

        const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
        expect(site.gristSyncedAt).toBeInstanceOf(Date);
        expect(site.gristSyncError).toBeNull();
    });

    it('keeps the reason of a failed push on the site, and clears it at the next good one', async () => {
        const siteId = await createSite();
        new FakeGrist().table('Sites', ['Title']).install();
        const failed = await push.pushSite(siteId);

        expect(failed?.error).toBe('Grist table Sites has no Domain column');
        let site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
        expect(site).toMatchObject({ gristSyncedAt: null, gristSyncError: failed?.error });

        document();
        expect((await push.pushSite(siteId))?.error).toBeNull();
        site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
        expect(site.gristSyncedAt).toBeInstanceOf(Date);
        expect(site.gristSyncError).toBeNull();
    });

    it('does nothing while Grist is not configured, or for a site that is gone', async () => {
        const grist = document();
        const siteId = await createSite();
        expect(await push.pushSite(siteId + 1000)).toBeNull();

        await prisma.settings.update({ where: { id: 1 }, data: { gristSitesTable: null } });
        expect(await push.pushSite(siteId)).toBeNull();
        expect(await push.pushAll()).toEqual([]);
        expect(grist.calls).toEqual([]);
    });
});

describe('pushAll', () => {
    it('pushes every site and reports each one', async () => {
        const grist = document();
        await createSite('a.test');
        await createSite('b.test');

        const results = await push.pushAll();
        expect(results.map((result) => [result.domain, result.error])).toEqual([
            ['a.test', null],
            ['b.test', null],
        ]);
        expect(grist.rows('Sites').map((row) => row.fields.Domain)).toEqual(['a.test', 'b.test']);
    });
});

describe('start', () => {
    it('pushes the site of every job that ends, once per job however often it is called', async () => {
        const grist = document();
        const siteId = await createSite();
        const job = await createJob(siteId, { status: 'error', finishedAt: new Date() });

        push.start();
        push.start();
        queue.events.emit('done', { jobId: job.id, status: 'error' });
        await vi.waitFor(() => expect(grist.rows('Sites')).toHaveLength(1));
        await push.idle();

        expect(grist.rows('Sites')[0]!.fields.LastBackupStatus).toBe('error');
        expect(grist.writes()).toHaveLength(1);
    });
});

describe('unlinkSite', () => {
    it('empties the link of a deleted site and swallows a Grist that is down', async () => {
        const grist = document();
        const siteId = await createSite();
        await push.pushSite(siteId);
        await prisma.site.delete({ where: { id: siteId } });

        await push.unlinkSite('site.test');
        expect(grist.rows('Sites')[0]!.fields).toMatchObject({
            Domain: 'site.test',
            RepositeUrl: '',
        });

        vi.stubGlobal('fetch', async () => {
            throw new TypeError('fetch failed');
        });
        const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await expect(push.unlinkSite('site.test')).resolves.toBeUndefined();
        expect(logged).toHaveBeenCalledOnce();
        logged.mockRestore();
    });
});
