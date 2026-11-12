'use client';

import { useRouter } from 'next/navigation';
import { JOB_STATUSES } from '@/lib/constants';

const SELECT_CLASS =
    'h-7 rounded-md border border-input bg-input/20 px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 md:text-xs/relaxed';

/** Site and status filters of the history page, kept in the URL so the server renders the matching page. Changing a filter goes back to page 1. */
export function HistoryFilters({
    sites,
    siteId,
    status,
}: {
    sites: { id: number; domain: string }[];
    siteId?: number;
    status?: string;
}) {
    const router = useRouter();

    function apply(next: { siteId?: string; status?: string }) {
        const params = new URLSearchParams();
        const site = next.siteId ?? (siteId ? String(siteId) : '');
        const state = next.status ?? status ?? '';
        if (site) params.set('siteId', site);
        if (state) params.set('status', state);
        const query = params.toString();
        router.push(query ? `/history?${query}` : '/history');
    }

    return (
        <div className="flex flex-wrap gap-3">
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
            <select
                aria-label="Status"
                className={SELECT_CLASS}
                value={status ?? ''}
                onChange={(e) => apply({ status: e.target.value })}
            >
                <option value="">All statuses</option>
                {JOB_STATUSES.map((value) => (
                    <option key={value} value={value}>
                        {value.charAt(0).toUpperCase() + value.slice(1)}
                    </option>
                ))}
            </select>
        </div>
    );
}
