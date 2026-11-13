import type { Metadata } from 'next';
import { GristSection } from '@/components/settings/GristSection';
import { GristSyncCard } from '@/components/settings/GristSyncCard';
import { getSettings, listSites, toSettingsView } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Grist settings' };

export default async function Page() {
    const [settings, sites] = await Promise.all([getSettings(), listSites()]);
    const configured = Boolean(
        settings.gristUrl &&
        settings.gristApiKeyEnc &&
        settings.gristDocId &&
        settings.gristSitesTable,
    );

    return (
        <div className="flex flex-col gap-4">
            <GristSection settings={toSettingsView(settings)} />
            <GristSyncCard
                configured={configured}
                sites={sites.map((site) => ({
                    id: site.id,
                    domain: site.domain,
                    syncedAt: site.gristSyncedAt?.toISOString() ?? null,
                    error: site.gristSyncError,
                }))}
            />
        </div>
    );
}
