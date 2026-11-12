'use client';

import { useRouter } from 'next/navigation';
import type { JobView } from '@/lib/constants';

const SELECT_CLASS =
    'h-7 rounded-md border border-input bg-input/20 px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 md:text-xs/relaxed';

const KIND_OPTIONS = [
    ['backup', 'Backups'],
    ['inventory', 'Inventories'],
    ['all', 'All types'],
] as const;

/** Type and site filters of the history page, kept in the URL so the server renders the matching page. The status is the business of the tabs, whose choice survives a filter change. Changing a filter goes back to page 1. */
export function HistoryFilters({
    sites,
    kind,
    siteId,
    view,
}: {
    sites: { id: number; domain: string }[];
    /** `backup` is the default and stays out of the URL. */
    kind: (typeof KIND_OPTIONS)[number][0];
    siteId?: number;
    view?: JobView;
}) {
    const router = useRouter();

    function apply(next: { kind?: string; siteId?: string }) {
        const params = new URLSearchParams();
        const type = next.kind ?? kind;
        const site = next.siteId ?? (siteId ? String(siteId) : '');
        if (type !== 'backup') params.set('kind', type);
        if (site) params.set('siteId', site);
        if (view) params.set('view', view);
        const query = params.toString();
        router.push(query ? `/history?${query}` : '/history');
    }

    return (
        <div className="flex flex-wrap gap-3">
            <select
                aria-label="Type"
                className={SELECT_CLASS}
                value={kind}
                onChange={(e) => apply({ kind: e.target.value })}
            >
                {KIND_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                        {label}
                    </option>
                ))}
            </select>
            <select
                aria-label="Site"
                className={SELECT_CLASS}
                value={siteId ?? ''}
                onChange={(e) => apply({ siteId: e.target.value })}
            >
                <option value="">All sites</option>
                {sites.map((site) => (
                    <option key={site.id} value={site.id}>
                        {site.domain}
                    </option>
                ))}
            </select>
        </div>
    );
}
