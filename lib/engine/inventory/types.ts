import type { LogEntry, RunOutcome } from '../types';

/** CMS the inventory knows how to read, one adapter each. */
export type CmsId = 'wordpress';

/** Product names, for the log and the interface. */
export const CMS_LABELS: Record<CmsId, string> = { wordpress: 'WordPress' };

export type ComponentType = 'plugin' | 'mu-plugin' | 'theme';

export interface Component {
    type: ComponentType;
    /** Directory name, or the file name without its extension for a single-file plugin. Unique per type on a site. */
    slug: string;
    /** Display name from the component's own header, the slug when it has none. */
    name: string;
    /** Null when the component declares no version, which is common for must-use plugins. */
    version: string | null;
}

export interface Inventory {
    cms: CmsId;
    /** Version of the CMS core. */
    version: string;
    /** Sorted by type, then slug. */
    components: Component[];
}

export interface InventoryEntry {
    name: string;
    type: 'file' | 'dir';
}

/**
 * What an adapter sees of a site, live over a connection or in the local copy a backup keeps: listings and file contents, with paths relative to the web root (`''` is the web root itself, `wp-content/plugins` a directory under it). Any error is thrown as is and ends the reading: an inventory is complete or it is not stored, since whoever consumes it treats a missing component as an uninstalled one.
 */
export interface InventoryReader {
    /** Entries of a directory. A directory is listed once per run, later calls are served from memory. */
    list(dir: string): Promise<InventoryEntry[]>;
    /** Content of a file as text. Empty, with a warning in the log, when the file is larger than any header file should be. */
    readText(file: string): Promise<string>;
}

export interface CmsAdapter {
    id: CmsId;
    /** Decides from the entries of the web root alone. */
    detect(rootEntries: readonly InventoryEntry[]): boolean;
    read(reader: InventoryReader): Promise<Omit<Inventory, 'cms'>>;
}

export interface InventoryOptions {
    signal?: AbortSignal;
    onLog?: (entry: LogEntry) => void;
}

export interface InventoryResult {
    status: RunOutcome;
    startedAt: Date;
    finishedAt: Date;
    durationMs: number;
    /** Null unless the run succeeded. */
    inventory: Inventory | null;
    errorMessage: string | null;
    /** Full text log of the run. */
    log: string;
}
