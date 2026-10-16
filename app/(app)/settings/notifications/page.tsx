import type { Metadata } from 'next';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { getSettings, toSettingsView } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Notification settings' };

export default async function Page() {
    return <NotificationsSection settings={toSettingsView(await getSettings())} />;
}
