import type { Metadata } from 'next';
import { GithubSection } from '@/components/settings/GithubSection';
import { getSettings, toSettingsView } from '@/lib/db';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'GitHub settings' };

export default async function Page() {
    return <GithubSection settings={toSettingsView(await getSettings())} />;
}
