import { errorMessage } from '../engine/cancel';
import { GristApiError, describeDoc, listColumnIds, listRecords } from './client';
import {
    COMPONENT_COLUMNS,
    REQUIRED_COMPONENT_COLUMNS,
    REQUIRED_SITE_COLUMNS,
    SITE_COLUMNS,
    bareDomain,
    domainVariants,
    type GristConfig,
} from './sync';

/**
 * What a sync would find, read-only: the document, the two tables with the columns they have and lack, and which sites already have a row. For the test button of Settings, so that a wrong table id or a domain written differently shows up before anything is written.
 */

export interface TableCheck {
    table: string;
    /** Why the table could not be read, null when it was. */
    error: string | null;
    /** Columns the sync cannot do without. */
    missingRequired: string[];
    /** Columns it would write if they existed. */
    missing: string[];
}

export interface SiteMatching {
    /** Sites that have exactly one row. */
    matched: number;
    /** Domains without a row: the first sync adds it. */
    unmatched: string[];
    /** Domains held by several rows: their sync fails until one is left. */
    ambiguous: string[];
}

export interface GristCheck {
    /** True when a sync can run. Missing optional columns and unmatched sites do not prevent it. */
    ok: boolean;
    /** Why the document could not be used at all, null otherwise. */
    error: string | null;
    docName: string | null;
    sites: TableCheck | null;
    /** Null when no components table is configured, or when the document could not be read. */
    components: TableCheck | null;
    /** Null when the sites table cannot be matched on. */
    matching: SiteMatching | null;
}

/** Domains per request when looking the sites up: the filter travels in the query string. */
const LOOKUP_BATCH = 50;

export async function checkGrist(config: GristConfig, domains: string[]): Promise<GristCheck> {
    const failed = (error: string): GristCheck => ({
        ok: false,
        error,
        docName: null,
        sites: null,
        components: null,
        matching: null,
    });

    let docName: string;
    try {
        const doc = await describeDoc(config);
        if (doc.access === 'viewers') {
            return failed('The API key can read this document but not write to it');
        }
        docName = doc.name;
    } catch (error) {
        return failed(describe(error, 'Document not found on this server'));
    }

    const sites = await checkTable(
        config,
        config.sitesTable,
        Object.values(SITE_COLUMNS),
        REQUIRED_SITE_COLUMNS,
    );
    const components = config.componentsTable
        ? await checkTable(
              config,
              config.componentsTable,
              Object.values(COMPONENT_COLUMNS),
              REQUIRED_COMPONENT_COLUMNS,
          )
        : null;
    const usable = (check: TableCheck | null): boolean =>
        !check || (!check.error && check.missingRequired.length === 0);

    let matching: SiteMatching | null = null;
    if (usable(sites)) {
        try {
            matching = await matchSites(config, domains);
        } catch (error) {
            return failed(describe(error, 'Table not found in the document'));
        }
    }

    return {
        ok: usable(sites) && usable(components),
        error: null,
        docName,
        sites,
        components,
        matching,
    };
}

async function checkTable(
    config: GristConfig,
    table: string,
    columns: readonly string[],
    required: readonly string[],
): Promise<TableCheck> {
    try {
        const existing = await listColumnIds(config, table);
        const absent = columns.filter((column) => !existing.has(column));
        return {
            table,
            error: null,
            missingRequired: absent.filter((column) => required.includes(column)),
            missing: absent.filter((column) => !required.includes(column)),
        };
    } catch (error) {
        return {
            table,
            error: describe(error, 'Table not found in the document'),
            missingRequired: [],
            missing: [],
        };
    }
}

async function matchSites(config: GristConfig, domains: string[]): Promise<SiteMatching> {
    const rows = new Map<string, number>();
    for (let start = 0; start < domains.length; start += LOOKUP_BATCH) {
        const batch = domains.slice(start, start + LOOKUP_BATCH);
        const records = await listRecords(config, config.sitesTable, {
            [SITE_COLUMNS.domain]: batch.flatMap(domainVariants),
        });
        for (const record of records) {
            const value = record.fields[SITE_COLUMNS.domain];
            if (typeof value !== 'string') continue;
            rows.set(bareDomain(value), (rows.get(bareDomain(value)) ?? 0) + 1);
        }
    }
    const count = (domain: string): number => rows.get(bareDomain(domain)) ?? 0;
    return {
        matched: domains.filter((domain) => count(domain) === 1).length,
        unmatched: domains.filter((domain) => count(domain) === 0),
        ambiguous: domains.filter((domain) => count(domain) > 1),
    };
}

/** A message someone can act on from the Settings page. `notFound` words a 404, which means a different thing for the document and for a table. */
function describe(error: unknown, notFound: string): string {
    if (!(error instanceof GristApiError)) {
        return `Could not reach the Grist server (${errorMessage(error)})`;
    }
    if (error.status === 401) return 'Grist rejected the API key';
    if (error.status === 403) return 'The API key has no access to this document';
    if (error.status === 404) return notFound;
    return error.message;
}
