import type { Metadata } from 'next';
import { BackupHistory } from '@/components/BackupHistory';
import { HistoryFilters } from '@/components/HistoryFilters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Card, CardContent } from '@/components/ui/card';
import { listJobs, listSites } from '@/lib/db';
import { jobsQuerySchema, type JobsQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'History' };

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

/** Filters and page from the URL; anything malformed falls back to the first unfiltered page. */
function parseQuery(params: SearchParams): JobsQuery {
    const raw = Object.fromEntries(
        ['kind', 'siteId', 'status', 'page']
            .map((key) => [key, params[key]] as const)
            .filter(([, value]) => typeof value === 'string' && value !== ''),
    );
    const parsed = jobsQuerySchema.safeParse({ ...raw, pageSize: PAGE_SIZE });
    return parsed.success ? parsed.data : jobsQuerySchema.parse({ pageSize: PAGE_SIZE });
}

function pageHref(query: JobsQuery, page: number): string {
    const params = new URLSearchParams();
    if (query.kind !== 'backup') params.set('kind', query.kind);
    if (query.siteId) params.set('siteId', String(query.siteId));
    if (query.status) params.set('status', query.status);
    if (page > 1) params.set('page', String(page));
    const text = params.toString();
    return text ? `/history?${text}` : '/history';
}

export default async function HistoryPage({
    searchParams,
}: {
    searchParams: Promise<SearchParams>;
}) {
    const query = parseQuery(await searchParams);
    const [backups, sites] = await Promise.all([listJobs(query), listSites()]);
    const filtered =
        query.kind !== 'backup' || query.siteId !== undefined || query.status !== undefined;

    return (
        <div className="space-y-6">
            <PageHeader
                title="History"
                subtitle="Backups by default; inventory runs are one filter away"
                action={
                    <HistoryFilters
                        sites={sites.map((site) => ({ id: site.id, domain: site.domain }))}
                        kind={query.kind}
                        siteId={query.siteId}
                        status={query.status}
                    />
                }
            />

            <Card>
                <CardContent className="p-0">
                    {backups.items.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <p>
                                {filtered
                                    ? 'No run matches these filters.'
                                    : 'No backups have been run yet.'}
                            </p>
                        </div>
                    ) : (
                        <BackupHistory
                            backups={backups.items}
                            showDomain={true}
                            kindFilter={query.kind}
                            siteId={query.siteId}
                            statusFilter={query.status}
                        />
                    )}
                    <Pagination
                        page={backups.page}
                        pageSize={backups.pageSize}
                        total={backups.total}
                        href={(page) => pageHref(query, page)}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
