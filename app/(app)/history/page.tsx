import type { Metadata } from 'next';
import Link from 'next/link';
import { RunAllButton } from '@/components/BackupActions';
import { BackupHistory } from '@/components/BackupHistory';
import { HistoryFilters } from '@/components/HistoryFilters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Card, CardContent } from '@/components/ui/card';
import type { JobView } from '@/lib/constants';
import { countJobViews, listJobs, listSites } from '@/lib/db';
import { jobsQuerySchema, type JobsQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'History' };

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

/** Filters, tab and page from the URL; anything malformed falls back to the first unfiltered page. */
function parseQuery(params: SearchParams): JobsQuery {
    const raw = Object.fromEntries(
        ['kind', 'siteId', 'view', 'page']
            .map((key) => [key, params[key]] as const)
            .filter(([, value]) => typeof value === 'string' && value !== ''),
    );
    const parsed = jobsQuerySchema.safeParse({ ...raw, pageSize: PAGE_SIZE });
    return parsed.success ? parsed.data : jobsQuerySchema.parse({ pageSize: PAGE_SIZE });
}

/** The same filters on another tab or page. Defaults stay out of the URL. */
function historyHref(query: JobsQuery, target: { view?: JobView; page?: number }): string {
    const params = new URLSearchParams();
    if (query.kind !== 'backup') params.set('kind', query.kind);
    if (query.siteId) params.set('siteId', String(query.siteId));
    if (target.view) params.set('view', target.view);
    if (target.page && target.page > 1) params.set('page', String(target.page));
    const text = params.toString();
    return text ? `/history?${text}` : '/history';
}

export default async function HistoryPage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const query = parseQuery(await searchParams);
    const [jobs, counts, sites] = await Promise.all([
        listJobs(query),
        countJobViews(query),
        listSites(),
    ]);
    const filtered =
        query.kind !== 'backup' || query.siteId !== undefined || query.view !== undefined;
    const tabs: { view?: JobView; label: string; count: number }[] = [
        { label: 'All', count: counts.all },
        { view: 'active', label: 'Active', count: counts.active },
        { view: 'issues', label: 'Issues', count: counts.issues },
    ];

    return (
        <div className="space-y-6">
            <PageHeader
                title="History"
                subtitle="Every run, newest first: backups by default, inventories through the type filter."
                action={
                    <div className="flex flex-wrap items-center gap-3">
                        <HistoryFilters
                            sites={sites.map((site) => ({ id: site.id, domain: site.domain }))}
                            kind={query.kind}
                            siteId={query.siteId}
                            view={query.view}
                        />
                        <RunAllButton />
                    </div>
                }
            />

            <nav className="flex gap-1" aria-label="Runs by status">
                {tabs.map((tab) => {
                    const current = query.view === tab.view;
                    // Issues call for attention as soon as there is one, selected or not.
                    const alert = tab.view === 'issues' && tab.count > 0;
                    return (
                        <Link
                            key={tab.label}
                            href={historyHref(query, { view: tab.view })}
                            aria-current={current ? 'page' : undefined}
                            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm no-underline transition-colors ${
                                current ? 'bg-popover' : 'hover:bg-popover/50'
                            } ${alert ? 'text-destructive' : current ? '' : 'text-muted-foreground'}`}
                        >
                            {tab.label}
                            <span
                                className={`rounded px-1.5 text-xs ${
                                    alert ? 'bg-destructive-tint' : 'text-muted-foreground'
                                }`}
                            >
                                {tab.count}
                            </span>
                        </Link>
                    );
                })}
            </nav>

            <Card>
                <CardContent className="p-0">
                    {jobs.items.length === 0 ? (
                        <div className="py-16 text-center text-muted-foreground">
                            <p>{filtered ? 'No run matches.' : 'No backups have been run yet.'}</p>
                        </div>
                    ) : (
                        <BackupHistory
                            backups={jobs.items}
                            showDomain={true}
                            kindFilter={query.kind}
                            siteId={query.siteId}
                            viewFilter={query.view}
                        />
                    )}
                    <Pagination
                        page={jobs.page}
                        pageSize={jobs.pageSize}
                        total={jobs.total}
                        href={(page) => historyHref(query, { view: query.view, page })}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
