/**
 * Views over the stored inventories, shared by the pages that show them. No database access here: the rows come in, the shapes the interface needs come out.
 */

export interface ComponentRow {
    /** CMS of the site the component was read on. */
    cms: string;
    type: string;
    slug: string;
    name: string;
    version: string | null;
    site: { id: number; domain: string };
}

export interface ComponentUsage {
    cms: string;
    type: string;
    slug: string;
    name: string;
    /** Sites the component is installed on, whatever the version. */
    siteCount: number;
    /** Newest first; the sites whose component declares no version come last. */
    versions: { version: string | null; sites: { id: number; domain: string }[] }[];
}

/**
 * Orders two version strings segment by segment, numbers as numbers: `4.10.3` is above `4.9.12`. Good enough to tell which of two installed versions is the older one; it does not know pre-releases, so `7.3-RC1` sorts above `7.3`.
 */
export function compareVersions(a: string, b: string): number {
    const left = a.split(/[.\-+_]/);
    const right = b.split(/[.\-+_]/);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i];
        const r = right[i];
        if (l === undefined) return -1;
        if (r === undefined) return 1;
        const numeric = /^\d+$/.test(l) && /^\d+$/.test(r);
        const order = numeric ? Number(l) - Number(r) : l.localeCompare(r, 'en');
        if (order !== 0) return order;
    }
    return 0;
}

/** The newest of the versions given, null when there is none. */
export function newestVersion(versions: readonly (string | null)[]): string | null {
    return versions.reduce<string | null>(
        (newest, version) =>
            version !== null && (newest === null || compareVersions(version, newest) > 0)
                ? version
                : newest,
        null,
    );
}

/**
 * One entry per component across the sites: which versions are installed, and where. A component is the same on two sites when its CMS, type and slug match (a WordPress theme and a PrestaShop theme may share a slug); the name is the one of its newest version. Sorted by name.
 */
export function groupComponents(rows: readonly ComponentRow[]): ComponentUsage[] {
    const groups = new Map<string, ComponentRow[]>();
    for (const row of rows) {
        const key = `${row.cms}\0${row.type}\0${row.slug}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    return [...groups.values()]
        .map((group) => {
            const byVersion = new Map<string | null, ComponentRow[]>();
            for (const row of group) {
                byVersion.set(row.version, [...(byVersion.get(row.version) ?? []), row]);
            }
            const versions = [...byVersion.entries()]
                .sort(([a], [b]) => {
                    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
                    return compareVersions(b, a);
                })
                .map(([version, members]) => ({
                    version,
                    sites: members
                        .map((member) => member.site)
                        .sort((a, b) => a.domain.localeCompare(b.domain, 'en')),
                }));
            const newest = versions[0].sites.length
                ? group.find((row) => row.version === versions[0].version)!
                : group[0];
            return {
                cms: group[0].cms,
                type: group[0].type,
                slug: group[0].slug,
                name: newest.name,
                siteCount: group.length,
                versions,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
