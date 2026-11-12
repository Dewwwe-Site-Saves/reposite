import { describe, expect, it } from 'vitest';
import { compareVersions, groupComponents, newestVersion, type ComponentRow } from './inventory';

describe('compareVersions', () => {
    it('compares numeric segments as numbers', () => {
        expect(compareVersions('4.10.3', '4.9.12')).toBeGreaterThan(0);
        expect(compareVersions('6.2.4.1', '6.2.4')).toBeGreaterThan(0);
        expect(compareVersions('1.4', '1.4.0')).toBeLessThan(0);
        expect(compareVersions('28.8', '28.8')).toBe(0);
    });

    it('falls back to text for segments that are not numbers', () => {
        expect(compareVersions('1.0-beta', '1.0-alpha')).toBeGreaterThan(0);
    });
});

describe('newestVersion', () => {
    it('ignores components without a version', () => {
        expect(newestVersion(['4.3.1', null, '4.3.5', '4.3.5'])).toBe('4.3.5');
        expect(newestVersion([null])).toBeNull();
        expect(newestVersion([])).toBeNull();
    });
});

describe('groupComponents', () => {
    const site = (id: number) => ({ id, domain: `site${id}.test` });
    const row = (
        siteId: number,
        slug: string,
        version: string | null,
        overrides: Partial<ComponentRow> = {},
    ): ComponentRow => ({
        cms: 'wordpress',
        type: 'plugin',
        slug,
        name: slug,
        version,
        site: site(siteId),
        ...overrides,
    });

    it('gathers the sites of a component under each installed version, newest first', () => {
        const usage = groupComponents([
            row(2, 'forms', '2.1.0'),
            row(1, 'forms', '2.2.0', { name: 'Forms' }),
            row(3, 'forms', '2.1.0'),
            row(4, 'forms', null),
        ]);

        expect(usage).toEqual([
            {
                cms: 'wordpress',
                type: 'plugin',
                slug: 'forms',
                name: 'Forms',
                siteCount: 4,
                versions: [
                    { version: '2.2.0', sites: [site(1)] },
                    { version: '2.1.0', sites: [site(2), site(3)] },
                    { version: null, sites: [site(4)] },
                ],
            },
        ]);
    });

    it('keeps the themes of two CMS apart even under one slug', () => {
        const usage = groupComponents([
            row(1, 'classic', '1.4', { type: 'theme' }),
            row(2, 'classic', '2.2.0', { type: 'theme', cms: 'prestashop' }),
        ]);

        expect(usage.map((entry) => [entry.cms, entry.siteCount])).toEqual([
            ['wordpress', 1],
            ['prestashop', 1],
        ]);
    });

    it('keeps a plugin and a theme of the same slug apart, and sorts by name', () => {
        const usage = groupComponents([
            row(1, 'storefront', '1.0', { type: 'theme', name: 'Storefront' }),
            row(1, 'storefront', '3.2', { name: 'storefront helper' }),
            row(1, 'akismet', '5.7', { name: 'Akismet' }),
        ]);

        expect(usage.map((entry) => [entry.name, entry.type])).toEqual([
            ['Akismet', 'plugin'],
            ['Storefront', 'theme'],
            ['storefront helper', 'plugin'],
        ]);
    });
});
