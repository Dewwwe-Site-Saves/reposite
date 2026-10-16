import Link from 'next/link';
import type { SiteWithLastBackup } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDuration } from '@/lib/format';

export function SiteCard({ site }: { site: SiteWithLastBackup }) {
    const last = site.lastBackup;
    const lastAt = last?.startedAt ?? last?.queuedAt ?? null;

    return (
        <Link href={`/sites/${site.id}`} className="no-underline">
            <Card
                className="border-l-4 hover:bg-muted/50 transition-colors cursor-pointer"
                style={{ borderLeftColor: statusColor(last?.status ?? null) }}
            >
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{site.domain}</CardTitle>
                        <StatusBadge status={last?.status ?? null} />
                    </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                    <div>Last backup: {lastAt ? new Date(lastAt).toLocaleString() : 'Never'}</div>
                    <div>Duration: {last?.durationMs ? formatDuration(last.durationMs) : '-'}</div>
                    <div>Protocol: {site.protocol.toUpperCase()}</div>
                </CardContent>
            </Card>
        </Link>
    );
}

function statusColor(status: string | null): string {
    if (!status) return 'var(--border)';
    if (status === 'success') return 'var(--success)';
    if (status === 'error') return 'var(--destructive)';
    return 'var(--warning)';
}
