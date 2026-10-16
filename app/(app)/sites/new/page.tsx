import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { SiteForm } from '@/components/SiteForm';
import { getSettings } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Add site' };

export default async function NewSitePage() {
    const { defaultCron } = await getSettings();

    return (
        <div className="max-w-3xl space-y-6">
            <PageHeader title="Add site" />
            <SiteForm mode="create" defaultCron={defaultCron} />
        </div>
    );
}
