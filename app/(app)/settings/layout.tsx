import { PageHeader } from '@/components/PageHeader';
import { SettingsNav, type SettingsNavStatus } from '@/components/settings/SettingsNav';
import { getSettings, toSettingsView, type SettingsView } from '@/lib/db';
import { SECRET_MASK } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** What the nav can tell without the client: whether each integration is set up. */
function navStatus(settings: SettingsView): SettingsNavStatus {
    const sharepoint = Boolean(
        settings.spTenantId &&
        settings.spClientId &&
        settings.spCertThumbprint &&
        settings.spTenantName &&
        settings.spSiteName &&
        settings.spListName &&
        settings.spDateField,
    );

    return {
        github:
            settings.githubToken === SECRET_MASK
                ? { text: 'Connected', tone: 'on' }
                : { text: 'Not set', tone: 'off' },
        sharepoint: sharepoint ? { text: 'On', tone: 'on' } : { text: 'Off', tone: 'off' },
        notifications: settings.notifyOnError
            ? { text: 'On', tone: 'on' }
            : { text: 'Off', tone: 'off' },
    };
}

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const settings = toSettingsView(await getSettings());

    return (
        <div className="space-y-3">
            <PageHeader
                title="Settings"
                subtitle="Configure GitHub repository integrations, SharePoint sync, alert triggers, and credentials."
            />
            <div className="flex flex-col gap-2.5 lg:flex-row">
                <SettingsNav status={navStatus(settings)} />
                <div className="min-w-0 flex-1">{children}</div>
            </div>
        </div>
    );
}
