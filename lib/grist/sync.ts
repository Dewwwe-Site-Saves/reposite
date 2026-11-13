import { CMS_LABELS, type CmsId, type Component } from '../engine/inventory/types';
import type { RunOutcome } from '../engine/types';
import {
    addRecords,
    listColumnIds,
    listRecords,
    updateRecords,
    type CellValue,
    type Fields,
    type GristConnection,
    type GristRecord,
    type RecordUpdate,
} from './client';

/**
 * Pushes what Reposite knows of a site to a Grist document: one row of a sites table, and one row per installed component in a components table. Pure like the engine: it sees a decrypted configuration and a snapshot of the site, never the database.
 *
 * The tables belong to the people who maintain the document, so the sync only ever writes its own columns, cell by cell, and only the cells whose value changed: a run that finds nothing new sends no write at all. It never deletes a row and never empties a cell it has no value for. The column ids are fixed (below); a column that does not exist in the table is not written and is named in the report, which is how a field is switched off.
 */

export interface GristConfig extends GristConnection {
    sitesTable: string;
    /** Null when components are not pushed. */
    componentsTable: string | null;
}

/** Columns of the sites table. `domain` is the key and must exist; `title`, `url` and `cms` are only written under the conditions described in `syncSite`. */
export const SITE_COLUMNS = {
    domain: 'Domain',
    title: 'Title',
    url: 'Url',
    cms: 'CMS',
    cmsVersion: 'CmsVersion',
    inventoryAt: 'InventoryAt',
    lastBackupAt: 'LastBackupAt',
    lastBackupStatus: 'LastBackupStatus',
    lastBackupUrl: 'LastBackupUrl',
    repositeUrl: 'RepositeUrl',
} as const;

/** Columns of the components table. `site` (a reference to the sites table), `type` and `slug` identify a row and must exist. */
export const COMPONENT_COLUMNS = {
    site: 'Site',
    type: 'Type',
    slug: 'Slug',
    name: 'Name',
    version: 'Version',
    previousVersion: 'PreviousVersion',
    versionChangedAt: 'VersionChangedAt',
    removedAt: 'RemovedAt',
} as const;

/** Written in the CMS column when Reposite created or found the cell empty and has not detected the CMS yet. A later run replaces it; any other value was typed by someone and is left alone. */
export const UNKNOWN_CMS = 'Inconnu';

/** Type of the row that carries the CMS core in the components table, next to the component types of the inventory. */
export const CORE_TYPE = 'core';

export interface SiteSnapshot {
    domain: string;
    cms: CmsId | null;
    cmsVersion: string | null;
    /** Date of the last complete inventory, null when the site has never been read. */
    inventoryAt: Date | null;
    /** Components of that inventory. */
    components: Component[];
    /** End of the last successful backup. */
    lastBackupAt: Date | null;
    /** Outcome of the last backup that ran, successful or not. */
    lastBackupStatus: RunOutcome | null;
    /** Most recent Release created by a backup: a run that found nothing to commit creates none. */
    lastBackupUrl: string | null;
    /** Page of the site in Reposite, null when the public URL of the app is not configured. */
    repositeUrl: string | null;
}

export interface SyncReport {
    /** Row of the site in the sites table. */
    siteRowId: number;
    /** True when the row did not exist and was added. */
    siteCreated: boolean;
    /** Columns of the site row written by this run. */
    siteColumns: string[];
    /** Null when the components were not synced: no components table, or no inventory yet. */
    components: { added: number; updated: number; removed: number } | null;
    /** Columns the sync would write that the tables do not have, as `Table.Column`. */
    missingColumns: string[];
}

export async function syncSite(config: GristConfig, snapshot: SiteSnapshot): Promise<SyncReport> {
    const missingColumns: string[] = [];
    const site = await syncSiteRow(config, snapshot, missingColumns);
    const components =
        config.componentsTable && snapshot.inventoryAt
            ? await syncComponents(
                  config,
                  config.componentsTable,
                  site.rowId,
                  snapshot,
                  snapshot.inventoryAt,
                  missingColumns,
              )
            : null;
    return {
        siteRowId: site.rowId,
        siteCreated: site.created,
        siteColumns: site.columns,
        components,
        missingColumns,
    };
}

// ============ Site row ============

async function syncSiteRow(
    config: GristConfig,
    snapshot: SiteSnapshot,
    missingColumns: string[],
): Promise<{ rowId: number; created: boolean; columns: string[] }> {
    const table = config.sitesTable;
    const columns = await listColumnIds(config, table);
    if (!columns.has(SITE_COLUMNS.domain)) {
        throw new Error(`Grist table ${table} has no ${SITE_COLUMNS.domain} column`);
    }

    const pushed: Fields = {
        [SITE_COLUMNS.cmsVersion]: snapshot.cmsVersion,
        [SITE_COLUMNS.inventoryAt]: toEpoch(snapshot.inventoryAt),
        [SITE_COLUMNS.lastBackupAt]: toEpoch(snapshot.lastBackupAt),
        [SITE_COLUMNS.lastBackupStatus]: snapshot.lastBackupStatus,
        [SITE_COLUMNS.lastBackupUrl]: snapshot.lastBackupUrl,
        [SITE_COLUMNS.repositeUrl]: snapshot.repositeUrl,
    };
    const desired: Fields = {};
    for (const [column, value] of Object.entries(pushed)) {
        if (!columns.has(column)) missingColumns.push(`${table}.${column}`);
        // Nothing to say is not the same as "empty": a cell is never cleared.
        else if (value !== null) desired[column] = value;
    }
    const cms = snapshot.cms ? CMS_LABELS[snapshot.cms] : UNKNOWN_CMS;

    const matches = await listRecords(config, table, {
        [SITE_COLUMNS.domain]: domainVariants(snapshot.domain),
    });
    if (matches.length > 1) {
        throw new Error(
            `Grist table ${table} has ${matches.length} rows for ${snapshot.domain} (rows ${matches.map((row) => row.id).join(', ')})`,
        );
    }

    const existing = matches[0];
    if (!existing) {
        const fields: Fields = { [SITE_COLUMNS.domain]: snapshot.domain, ...desired };
        if (columns.has(SITE_COLUMNS.title)) fields[SITE_COLUMNS.title] = snapshot.domain;
        if (columns.has(SITE_COLUMNS.url)) fields[SITE_COLUMNS.url] = `https://${snapshot.domain}`;
        if (columns.has(SITE_COLUMNS.cms)) fields[SITE_COLUMNS.cms] = cms;
        const [rowId] = await addRecords(config, table, [fields]);
        if (rowId === undefined) throw new Error(`Grist did not return the row added to ${table}`);
        return { rowId, created: true, columns: Object.keys(fields) };
    }

    const changes = changedCells(existing, desired);
    if (columns.has(SITE_COLUMNS.cms)) {
        const current = existing.fields[SITE_COLUMNS.cms];
        if ((isEmpty(current) || current === UNKNOWN_CMS) && current !== cms) {
            changes[SITE_COLUMNS.cms] = cms;
        }
    }
    await updateRecords(config, table, [{ id: existing.id, fields: changes }]);
    return { rowId: existing.id, created: false, columns: Object.keys(changes) };
}

/** A domain is looked up with and without its `www.`, whichever way the document writes it. */
function domainVariants(domain: string): string[] {
    const bare = domain.replace(/^www\./, '');
    return [bare, `www.${bare}`];
}

// ============ Components ============

async function syncComponents(
    config: GristConfig,
    table: string,
    siteRowId: number,
    snapshot: SiteSnapshot,
    inventoryAt: Date,
    missingColumns: string[],
): Promise<{ added: number; updated: number; removed: number }> {
    const columns = await listColumnIds(config, table);
    const identity = [COMPONENT_COLUMNS.site, COMPONENT_COLUMNS.type, COMPONENT_COLUMNS.slug];
    for (const column of identity) {
        if (!columns.has(column)) throw new Error(`Grist table ${table} has no ${column} column`);
    }
    const has = (column: string): boolean => columns.has(column);
    for (const column of Object.values(COMPONENT_COLUMNS)) {
        if (!has(column)) missingColumns.push(`${table}.${column}`);
    }
    const readAt = toEpoch(inventoryAt);

    // What the table should say of this site: the core as a row of its own, then every component. A missing version is an empty cell.
    const desired = new Map<string, ComponentRow>();
    if (snapshot.cms) {
        desired.set(rowKey(CORE_TYPE, snapshot.cms), {
            type: CORE_TYPE,
            slug: snapshot.cms,
            name: CMS_LABELS[snapshot.cms],
            version: snapshot.cmsVersion ?? '',
        });
    }
    for (const component of snapshot.components) {
        desired.set(rowKey(component.type, component.slug), {
            type: component.type,
            slug: component.slug,
            name: component.name,
            version: component.version ?? '',
        });
    }

    const rows = await listRecords(config, table, { [COMPONENT_COLUMNS.site]: [siteRowId] });
    const existing = new Map<string, GristRecord>();
    for (const row of rows) {
        const key = rowKey(
            text(row.fields[COMPONENT_COLUMNS.type]),
            text(row.fields[COMPONENT_COLUMNS.slug]),
        );
        // Should two rows carry the same component, the first one is the one kept up to date.
        if (!existing.has(key)) existing.set(key, row);
    }

    const additions: Fields[] = [];
    const updates: RecordUpdate[] = [];
    let updated = 0;
    let removed = 0;

    for (const [key, component] of desired) {
        const row = existing.get(key);
        if (!row) {
            const fields: Fields = {
                [COMPONENT_COLUMNS.site]: siteRowId,
                [COMPONENT_COLUMNS.type]: component.type,
                [COMPONENT_COLUMNS.slug]: component.slug,
            };
            if (has(COMPONENT_COLUMNS.name)) fields[COMPONENT_COLUMNS.name] = component.name;
            if (has(COMPONENT_COLUMNS.version))
                fields[COMPONENT_COLUMNS.version] = component.version;
            additions.push(fields);
            continue;
        }
        const changes: Fields = {};
        if (
            has(COMPONENT_COLUMNS.name) &&
            text(row.fields[COMPONENT_COLUMNS.name]) !== component.name
        ) {
            changes[COMPONENT_COLUMNS.name] = component.name;
        }
        const previous = text(row.fields[COMPONENT_COLUMNS.version]);
        if (has(COMPONENT_COLUMNS.version) && previous !== component.version) {
            changes[COMPONENT_COLUMNS.version] = component.version;
            if (has(COMPONENT_COLUMNS.previousVersion)) {
                changes[COMPONENT_COLUMNS.previousVersion] = previous;
            }
            if (has(COMPONENT_COLUMNS.versionChangedAt)) {
                changes[COMPONENT_COLUMNS.versionChangedAt] = readAt;
            }
        }
        // Back after having been removed: the row is the same one, with whatever was written next to it.
        if (has(COMPONENT_COLUMNS.removedAt) && !isEmpty(row.fields[COMPONENT_COLUMNS.removedAt])) {
            changes[COMPONENT_COLUMNS.removedAt] = null;
        }
        if (Object.keys(changes).length > 0) {
            updates.push({ id: row.id, fields: changes });
            updated++;
        }
    }

    // A component the inventory no longer finds keeps its row and gets the date it went missing. Without the column there is nothing to mark it with, and the row is left as it is.
    if (has(COMPONENT_COLUMNS.removedAt)) {
        for (const [key, row] of existing) {
            if (desired.has(key) || !isEmpty(row.fields[COMPONENT_COLUMNS.removedAt])) continue;
            updates.push({ id: row.id, fields: { [COMPONENT_COLUMNS.removedAt]: readAt } });
            removed++;
        }
    }

    await addRecords(config, table, additions);
    await updateRecords(config, table, updates);
    return { added: additions.length, updated, removed };
}

interface ComponentRow {
    type: string;
    slug: string;
    name: string;
    version: string;
}

function rowKey(type: string, slug: string): string {
    return `${type}\n${slug}`;
}

// ============ Cells ============

/** Dates are written as epoch seconds, which is also how Grist returns them. */
function toEpoch(date: Date | null): number | null {
    return date ? Math.floor(date.getTime() / 1000) : null;
}

function isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === '';
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function sameCell(current: unknown, desired: CellValue): boolean {
    if (typeof desired === 'number') {
        return typeof current === 'number' && Math.floor(current) === desired;
    }
    return current === desired;
}

/** The cells of `desired` whose value differs from what the row holds. */
function changedCells(row: GristRecord, desired: Fields): Fields {
    const changes: Fields = {};
    for (const [column, value] of Object.entries(desired)) {
        if (!sameCell(row.fields[column], value)) changes[column] = value;
    }
    return changes;
}
