import { listSitesWithLastBackup } from '@/lib/db';
import { SiteCard } from '@/components/SiteCard';
import { RunAllButton } from '@/components/BackupActions';
import { PageHeader } from '@/components/PageHeader';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
    const sites = await listSitesWithLastBackup();

    return (
        <div className="space-y-6">
            <PageHeader
                title="Dashboard"
                subtitle={`${sites.length} site${sites.length !== 1 ? 's' : ''} configured`}
                action={sites.length > 0 && <RunAllButton />}
            />

            {sites.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <p>No sites configured yet.</p>
                    <Link href="/sites/new" className="text-primary hover:underline">
                        Add your first site
                    </Link>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sites.map((site) => (
                        <SiteCard key={site.id} site={site} />
                    ))}
                </div>
            )}
        </div>
    );
}
