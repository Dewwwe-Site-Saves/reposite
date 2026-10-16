import type { Metadata } from 'next';
import { SharePointSection } from '@/components/settings/SharePointSection';
import { getSettings, toSettingsView } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'SharePoint settings' };

export default async function Page() {
    return <SharePointSection settings={toSettingsView(await getSettings())} />;
}
