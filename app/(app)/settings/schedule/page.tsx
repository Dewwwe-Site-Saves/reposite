import type { Metadata } from 'next';
import { ScheduleSection } from '@/components/settings/ScheduleSection';
import { describeCron } from '@/lib/cron';
import { getSettings, toSettingsView } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Schedule settings' };

export default async function Page() {
    const settings = await getSettings();

    return (
        <ScheduleSection
            settings={toSettingsView(settings)}
            summary={describeCron(settings.defaultCron)}
        />
    );
}
