import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGrist } from './check';
import { COMPONENT_COLUMNS, SITE_COLUMNS, type GristConfig } from './sync';
import { FakeGrist } from './testing/fake-grist';

const config: GristConfig = {
    serverUrl: 'https://grist.example.com',
    apiKey: 'secret-key',
    docId: 'doc1',
    sitesTable: 'Sites',
    componentsTable: 'Components',
};

function document(): FakeGrist {
    return new FakeGrist()
        .table('Sites', Object.values(SITE_COLUMNS), [
            { Domain: 'example.com' },
            { Domain: 'www.other.test' },
            { Domain: 'twice.test' },
            { Domain: 'www.twice.test' },
        ])
        .table('Components', Object.values(COMPONENT_COLUMNS));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('checkGrist', () => {
    it('passes a complete document and says which sites have a row, without writing', async () => {
        const grist = document().install();
        const check = await checkGrist(config, [
            'www.example.com',
            'other.test',
            'twice.test',
            'new.test',
        ]);

        expect(check).toEqual({
            ok: true,
            error: null,
            docName: 'Fake document',
            sites: { table: 'Sites', error: null, missingRequired: [], missing: [] },
            components: { table: 'Components', error: null, missingRequired: [], missing: [] },
            matching: { matched: 2, unmatched: ['new.test'], ambiguous: ['twice.test'] },
        });
        expect(grist.writes()).toEqual([]);
    });

    it('lists the optional columns a table lacks and still passes', async () => {
        new FakeGrist()
            .table('Sites', ['Domain', 'CmsVersion', 'InventoryAt'])
            .table('Components', ['Site', 'Type', 'Slug', 'Version'])
            .install();
        const check = await checkGrist(config, []);

        expect(check.ok).toBe(true);
        expect(check.sites?.missing).toEqual([
            'Title',
            'Url',
            'CMS',
            'LastBackupAt',
            'LastBackupStatus',
            'LastBackupUrl',
            'RepositeUrl',
        ]);
        expect(check.components?.missing).toEqual([
            'Name',
            'PreviousVersion',
            'VersionChangedAt',
            'Status',
            'RemovedAt',
        ]);
    });

    it('fails on a missing key column, and does not try to match the sites', async () => {
        new FakeGrist().table('Sites', ['Title']).table('Components', ['Site', 'Slug']).install();
        const check = await checkGrist(config, ['example.com']);

        expect(check.ok).toBe(false);
        expect(check.sites?.missingRequired).toEqual(['Domain']);
        expect(check.components?.missingRequired).toEqual(['Type']);
        expect(check.matching).toBeNull();
    });

    it('names the table that does not exist', async () => {
        new FakeGrist().table('Sites', ['Domain']).install();
        const check = await checkGrist(config, []);

        expect(check.ok).toBe(false);
        expect(check.sites?.error).toBeNull();
        expect(check.components).toMatchObject({
            table: 'Components',
            error: 'Table not found in the document',
        });
    });

    it('skips the components table when none is configured', async () => {
        document().install();
        const check = await checkGrist({ ...config, componentsTable: null }, []);

        expect(check.ok).toBe(true);
        expect(check.components).toBeNull();
    });

    it('names the login proxy that answers instead of Grist, and a URL that is not an API', async () => {
        vi.stubGlobal('fetch', async (_input: string, init: RequestInit) => {
            expect(init.redirect).toBe('manual');
            return new Response(null, {
                status: 302,
                headers: {
                    Location: 'https://auth.example.com/?rd=https%3A%2F%2Fgrist.example.com',
                },
            });
        });
        expect((await checkGrist(config, [])).error).toBe(
            'auth.example.com answered instead of Grist (redirect on GET /): a login proxy sits in front of this URL, use an address that reaches Grist directly',
        );

        vi.stubGlobal('fetch', async () => new Response('<html>Sign in</html>', { status: 200 }));
        expect((await checkGrist(config, [])).error).toBe(
            'Unexpected answer to GET /: this URL does not lead to a Grist API',
        );

        // A 200 with nothing in it, or with JSON that is not an object, is not Grist either.
        for (const body of ['', 'null', '"ok"']) {
            vi.stubGlobal('fetch', async () => new Response(body, { status: 200 }));
            expect((await checkGrist(config, [])).error).toBe(
                'Unexpected answer to GET /: this URL does not lead to a Grist API',
            );
        }
    });

    it('explains a rejected key, a read-only key and an unreachable server', async () => {
        const grist = document().install();
        expect(await checkGrist({ ...config, apiKey: 'wrong' }, [])).toMatchObject({
            ok: false,
            error: 'Grist rejected the API key',
            sites: null,
        });

        grist.access = 'viewers';
        expect((await checkGrist(config, [])).error).toBe(
            'The API key can read this document but not write to it',
        );

        vi.stubGlobal('fetch', async () => {
            throw new TypeError('fetch failed');
        });
        expect((await checkGrist(config, [])).error).toBe(
            'Could not reach the Grist server (fetch failed)',
        );
    });
});
