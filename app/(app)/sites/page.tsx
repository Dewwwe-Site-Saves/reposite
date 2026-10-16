import { listSites } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { SitesTable } from '@/components/SitesTable';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
    const sites = await listSites();

    return (
        <div className="space-y-6">
            <PageHeader
                title="Sites"
                subtitle="Manage your WordPress sites"
                action={
                    <Link href="/sites/new">
                        <Button>Add Site</Button>
                    </Link>
                }
            />

            <Card>
                <CardContent className="p-0">
                    {sites.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <p>No sites configured yet.</p>
                            <Link href="/sites/new" className="text-primary hover:underline">
                                Add your first site
                            </Link>
                        </div>
                    ) : (
                        <SitesTable sites={sites} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
