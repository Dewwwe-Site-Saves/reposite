import type { Metadata } from 'next';
import { BackupHistory } from '@/components/BackupHistory';
import { HistoryFilters } from '@/components/HistoryFilters';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { Card, CardContent } from '@/components/ui/card';
import { listBackups, listSites } from '@/lib/db';
import { backupsQuerySchema, type BackupsQuery } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'History' };

const PAGE_SIZE = 25;

type SearchParams = Record<string, string | string[] | undefined>;

/** Filters and page from the URL; anything malformed falls back to the first unfiltered page. */
function parseQuery(params: SearchParams): BackupsQuery {
    const raw = Object.fromEntries(
        ['siteId', 'status', 'page']
            .map((key) => [key, params[key]] as const)
            .filter(([, value]) => typeof value === 'string' && value !== ''),
    );
    const parsed = backupsQuerySchema.safeParse({ ...raw, pageSize: PAGE_SIZE });
    return parsed.success ? parsed.data : backupsQuerySchema.parse({ pageSize: PAGE_SIZE });
}

function pageHref(query: BackupsQuery, page: number): string {
    const params = new URLSearchParams();
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
    const [backups, sites] = await Promise.all([listBackups(query), listSites()]);
    const filtered = query.siteId !== undefined || query.status !== undefined;

    return (
        <div className="space-y-6">
            <PageHeader
                title="History"
                subtitle="Backup execution history"
                action={
                    <HistoryFilters
                        sites={sites.map((site) => ({ id: site.id, domain: site.domain }))}
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
                                    ? 'No backups match these filters.'
                                    : 'No backups have been run yet.'}
                            </p>
                        </div>
                    ) : (
                        <BackupHistory
                            backups={backups.items}
                            showDomain={true}
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
