/** Display helpers shared by server and client components. */

import { CMS_LABELS, type ComponentType } from './engine/inventory/types';

export function formatDuration(ms: number): string {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const RELATIVE_UNITS: [limit: number, seconds: number, unit: string][] = [
    [3600, 60, 'minute'],
    [86_400, 3600, 'hour'],
    [30 * 86_400, 86_400, 'day'],
    [365 * 86_400, 30 * 86_400, 'month'],
    [Infinity, 365 * 86_400, 'year'],
];

/** `9 days ago`: how long before `now` a date was, in the largest unit that fits. Under a minute, and for a date in the future (two clocks that disagree), `just now`. */
export function formatRelative(date: Date, now: Date): string {
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const [, size, unit] = RELATIVE_UNITS.find(([limit]) => seconds < limit)!;
    const count = Math.floor(seconds / size);
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/** Labels for the run options, e.g. ["Full", "No git"]. */
export function optionLabels(fullDownload: boolean, skipGit: boolean, long = false): string[] {
    const labels: string[] = [];
    if (fullDownload) labels.push(long ? 'Full download' : 'Full');
    if (skipGit) labels.push('No git');
    return labels;
}

/** Product name of a detected CMS. The raw id for one this build does not know: a row written by a newer version. */
export function cmsLabel(cms: string): string {
    return (CMS_LABELS as Record<string, string>)[cms] ?? cms;
}

/** Component types in the order the interface lists them, with their plural heading. */
export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
    plugin: 'Plugins',
    'mu-plugin': 'Must-use plugins',
    module: 'Modules',
    theme: 'Themes',
};
