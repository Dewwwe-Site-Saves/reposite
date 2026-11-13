import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Component } from '../engine/inventory/types';
import { GristApiError, listColumnIds } from './client';
import { FakeGrist } from './testing/fake-grist';
import { clearSiteLink, syncSite, type GristConfig, type SiteSnapshot } from './sync';

const config: GristConfig = {
    serverUrl: 'https://grist.example.com/',
    apiKey: 'secret-key',
    docId: 'doc1',
    sitesTable: 'Sites',
    componentsTable: 'Components',
};

const SITE_COLUMNS = [
    'Title',
    'Url',
    'Domain',
    'CMS',
    'Notes',
    'CmsVersion',
    'InventoryAt',
    'LastBackupAt',
    'LastBackupStatus',
    'LastBackupUrl',
    'RepositeUrl',
];
const COMPONENT_COLUMNS = [
    'Site',
    'Type',
    'Slug',
    'Name',
    'Version',
    'PreviousVersion',
    'VersionChangedAt',
    'Status',
    'RemovedAt',
    'Decision',
];

const INVENTORY_AT = new Date('2026-11-13T04:00:10Z');
const BACKUP_AT = new Date('2026-11-01T02:03:00Z');
const epoch = (date: Date): number => Math.floor(date.getTime() / 1000);

function plugin(slug: string, version: string | null, name = slug): Component {
    return { type: 'plugin', slug, name, version };
}

function snapshot(overrides: Partial<SiteSnapshot> = {}): SiteSnapshot {
    return {
        domain: 'example.com',
        cms: 'wordpress',
        cmsVersion: '7.1.4',
        inventoryAt: INVENTORY_AT,
        components: [plugin('akismet', '5.3', 'Akismet'), plugin('hello', null, 'Hello Dolly')],
        lastBackupAt: BACKUP_AT,
        lastBackupStatus: 'success',
        lastBackupUrl: 'https://github.com/o/r/releases/tag/20261101-020300',
        repositeUrl: 'https://reposite.example.com/sites/3',
        ...overrides,
    };
}

function document(): FakeGrist {
    return new FakeGrist().table('Sites', SITE_COLUMNS).table('Components', COMPONENT_COLUMNS);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('syncSite, site row', () => {
    it('adds the row of a domain the table does not know', async () => {
        const grist = document().install();
        const report = await syncSite(config, snapshot());

        expect(report.siteCreated).toBe(true);
        expect(grist.rows('Sites')).toEqual([
            {
                id: report.siteRowId,
                fields: {
                    Domain: 'example.com',
                    Title: 'example.com',
                    Url: 'https://example.com',
                    CMS: 'WordPress',
                    CmsVersion: '7.1.4',
                    InventoryAt: epoch(INVENTORY_AT),
                    LastBackupAt: epoch(BACKUP_AT),
                    LastBackupStatus: 'success',
                    LastBackupUrl: 'https://github.com/o/r/releases/tag/20261101-020300',
                    RepositeUrl: 'https://reposite.example.com/sites/3',
                },
            },
        ]);
    });

    it('leaves the CMS empty until it is detected, then names it', async () => {
        const grist = document().install();
        await syncSite(config, snapshot({ cms: null, cmsVersion: null, inventoryAt: null }));
        expect(grist.rows('Sites')[0]!.fields.CMS).toBeUndefined();

        await syncSite(config, snapshot({ cms: 'prestashop', cmsVersion: '8.2.3' }));
        expect(grist.rows('Sites')).toHaveLength(1);
        expect(grist.rows('Sites')[0]!.fields.CMS).toBe('PrestaShop');
    });

    it('writes the changed cells of an existing row and nothing else', async () => {
        const grist = new FakeGrist()
            .table('Sites', SITE_COLUMNS, [
                {
                    Title: 'Example',
                    Url: 'https://www.example.com/',
                    Domain: 'www.example.com',
                    CMS: 'Autre',
                    Notes: 'typed by someone',
                    CmsVersion: '7.1.3',
                    LastBackupStatus: 'success',
                },
            ])
            .table('Components', COMPONENT_COLUMNS)
            .install();
        const report = await syncSite(config, snapshot({ components: [], inventoryAt: null }));

        expect(report.siteCreated).toBe(false);
        expect(report.siteColumns.sort()).toEqual([
            'CmsVersion',
            'LastBackupAt',
            'LastBackupUrl',
            'RepositeUrl',
        ]);
        expect(grist.rows('Sites')[0]!.fields).toMatchObject({
            Title: 'Example',
            Url: 'https://www.example.com/',
            Domain: 'www.example.com',
            CMS: 'Autre',
            Notes: 'typed by someone',
            CmsVersion: '7.1.4',
        });
    });

    it('sends no write when nothing changed', async () => {
        const grist = document().install();
        await syncSite(config, snapshot());
        const before = grist.writes().length;

        const report = await syncSite(config, snapshot());
        expect(grist.writes()).toHaveLength(before);
        expect(report.siteColumns).toEqual([]);
        expect(report.components).toEqual({ added: 0, updated: 0, removed: 0 });
    });

    it('never empties a cell it has no value for', async () => {
        const grist = document().install();
        await syncSite(config, snapshot());
        await syncSite(config, snapshot({ lastBackupUrl: null, lastBackupAt: null }));

        expect(grist.rows('Sites')[0]!.fields.LastBackupAt).toBe(epoch(BACKUP_AT));
        expect(grist.rows('Sites')[0]!.fields.LastBackupUrl).toContain('/releases/tag/');
    });

    it('skips the columns the table does not have and reports them', async () => {
        const grist = new FakeGrist()
            .table('Sites', ['Domain', 'CmsVersion'])
            .table('Components', ['Site', 'Type', 'Slug', 'Version'])
            .install();
        const report = await syncSite(config, snapshot());

        expect(grist.rows('Sites')[0]!.fields).toEqual({
            Domain: 'example.com',
            CmsVersion: '7.1.4',
        });
        expect(report.missingColumns).toEqual([
            'Sites.InventoryAt',
            'Sites.LastBackupAt',
            'Sites.LastBackupStatus',
            'Sites.LastBackupUrl',
            'Sites.RepositeUrl',
            'Components.Name',
            'Components.PreviousVersion',
            'Components.VersionChangedAt',
            'Components.Status',
            'Components.RemovedAt',
        ]);
    });

    it('refuses a table without the key column, and a domain held by two rows', async () => {
        new FakeGrist().table('Sites', ['Title']).install();
        await expect(syncSite(config, snapshot())).rejects.toThrow('has no Domain column');

        new FakeGrist()
            .table('Sites', SITE_COLUMNS, [
                { Domain: 'example.com' },
                { Domain: 'www.example.com' },
            ])
            .install();
        await expect(syncSite(config, snapshot())).rejects.toThrow('2 rows for example.com');
    });
});

describe('syncSite, components', () => {
    it('adds one row per component, and one for the core', async () => {
        const grist = document().install();
        const report = await syncSite(config, snapshot());

        expect(report.components).toEqual({ added: 3, updated: 0, removed: 0 });
        expect(grist.rows('Components').map((row) => row.fields)).toEqual([
            {
                Site: report.siteRowId,
                Type: 'core',
                Slug: 'wordpress',
                Name: 'WordPress',
                Version: '7.1.4',
                Status: 'installed',
            },
            {
                Site: report.siteRowId,
                Type: 'plugin',
                Slug: 'akismet',
                Name: 'Akismet',
                Version: '5.3',
                Status: 'installed',
            },
            {
                Site: report.siteRowId,
                Type: 'plugin',
                Slug: 'hello',
                Name: 'Hello Dolly',
                Version: '',
                Status: 'installed',
            },
        ]);
    });

    it('keeps the previous version and the date of a change, next to what people wrote', async () => {
        const grist = document().install();
        await syncSite(config, snapshot());
        const akismet = grist.rows('Components').find((row) => row.fields.Slug === 'akismet')!;
        const hello = grist.rows('Components').find((row) => row.fields.Slug === 'hello')!;
        akismet.fields.Decision = 'Keep';
        hello.fields.Decision = 'Remove';

        const later = new Date('2026-11-14T04:00:07Z');
        const report = await syncSite(
            config,
            snapshot({
                inventoryAt: later,
                components: [plugin('akismet', '5.4', 'Akismet'), plugin('hello', null, 'Hello')],
            }),
        );

        expect(report.components).toEqual({ added: 0, updated: 2, removed: 0 });
        expect(akismet.fields).toMatchObject({
            Name: 'Akismet',
            Version: '5.4',
            PreviousVersion: '5.3',
            VersionChangedAt: epoch(later),
            Decision: 'Keep',
        });
        // A different set of columns in the same run: neither row loses a cell to the other.
        expect(hello.fields).toMatchObject({ Name: 'Hello', Version: '', Decision: 'Remove' });
        expect(hello.fields.PreviousVersion).toBeUndefined();
    });

    it('dates a component that is gone and revives its row when it comes back', async () => {
        const grist = document().install();
        await syncSite(config, snapshot());
        const hello = grist.rows('Components').find((row) => row.fields.Slug === 'hello')!;
        hello.fields.Decision = 'Remove';

        const later = new Date('2026-11-14T04:00:07Z');
        const gone = snapshot({
            inventoryAt: later,
            components: [plugin('akismet', '5.3', 'Akismet')],
        });
        expect((await syncSite(config, gone)).components).toEqual({
            added: 0,
            updated: 0,
            removed: 1,
        });
        expect(grist.rows('Components')).toHaveLength(3);
        expect(hello.fields).toMatchObject({ Status: 'removed', RemovedAt: epoch(later) });

        // Still gone the next day: the date of the first absence stays.
        const before = grist.writes().length;
        await syncSite(config, { ...gone, inventoryAt: new Date('2026-11-15T04:00:00Z') });
        expect(grist.writes().length).toBe(before + 1);
        expect(hello.fields.RemovedAt).toBe(epoch(later));

        const back = await syncSite(
            config,
            snapshot({ inventoryAt: new Date('2026-11-16T04:00:00Z') }),
        );
        expect(back.components).toEqual({ added: 0, updated: 1, removed: 0 });
        expect(grist.rows('Components')).toHaveLength(3);
        expect(hello.fields).toMatchObject({
            Status: 'installed',
            RemovedAt: null,
            Decision: 'Remove',
        });
    });

    it('only touches the rows of its own site', async () => {
        const grist = document().install();
        await syncSite(config, snapshot({ domain: 'other.test' }));
        await syncSite(config, snapshot({ components: [] }));

        const removed = grist.rows('Components').filter((row) => row.fields.RemovedAt);
        expect(removed).toEqual([]);
        expect(grist.rows('Components')).toHaveLength(4);
    });

    it('leaves the components alone until the site has an inventory', async () => {
        const grist = document().install();
        const report = await syncSite(config, snapshot({ inventoryAt: null, components: [] }));

        expect(report.components).toBeNull();
        expect(grist.calls.some((call) => call.table === 'Components')).toBe(false);
    });

    it('does nothing with the components when no table is configured', async () => {
        const grist = document().install();
        const report = await syncSite({ ...config, componentsTable: null }, snapshot());

        expect(report.components).toBeNull();
        expect(grist.rows('Components')).toEqual([]);
    });
});

describe('clearSiteLink', () => {
    it('empties the link of a site that left, and nothing else', async () => {
        const grist = document().install();
        await syncSite(config, snapshot());
        const row = grist.rows('Sites')[0]!;
        const components = structuredClone(grist.rows('Components'));

        expect(await clearSiteLink(config, 'www.example.com')).toBe(true);
        expect(row.fields).toMatchObject({
            Domain: 'example.com',
            RepositeUrl: '',
            CmsVersion: '7.1.4',
            LastBackupAt: epoch(BACKUP_AT),
        });
        expect(grist.rows('Components')).toEqual(components);

        const before = grist.writes().length;
        expect(await clearSiteLink(config, 'example.com')).toBe(false);
        expect(await clearSiteLink(config, 'unknown.test')).toBe(false);
        expect(grist.writes()).toHaveLength(before);
    });
});

describe('client', () => {
    it('surfaces the message of the server, never the key', async () => {
        document().install();
        const error = await listColumnIds({ ...config, apiKey: 'wrong' }, 'Sites').catch(
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(GristApiError);
        expect((error as GristApiError).status).toBe(401);
        expect((error as GristApiError).message).toBe(
            'Grist API 401 on GET /tables/Sites/columns: invalid API key',
        );
    });
});
