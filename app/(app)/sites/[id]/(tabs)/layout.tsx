import { notFound } from 'next/navigation';
import { RunBackupButton } from '@/components/BackupActions';
import { PageHeader } from '@/components/PageHeader';
import { SiteTabs } from '@/components/SiteTabs';
import { Badge } from '@/components/ui/badge';
import { countSiteComponents, getSite } from '@/lib/db';
import { cmsLabel } from '@/lib/format';
import { parseId } from '@/lib/validation';
import { SiteDetailActions } from '../actions';

export const dynamic = 'force-dynamic';

/** Header and tabs shared by the pages of one site. The edit form lives outside this group and keeps its own header. */
export default async function SiteLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ id: string }>;
}) {
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) notFound();
    const componentCount = await countSiteComponents(site.id);

    return (
        <div className="max-w-4xl space-y-6">
            <PageHeader
                title={
                    <span className="flex items-center gap-3">
                        {site.domain}
                        {site.enabled ? (
                            <Badge variant="default">Active</Badge>
                        ) : (
                            <Badge variant="secondary">Disabled</Badge>
                        )}
                    </span>
                }
                subtitle={
                    site.cms && site.cmsVersion
                        ? `${cmsLabel(site.cms)} ${site.cmsVersion}`
                        : undefined
                }
                action={
                    <div className="flex gap-2">
                        <RunBackupButton siteId={site.id} domain={site.domain} size="default" />
                        <SiteDetailActions siteId={site.id} />
                    </div>
                }
            />
            <SiteTabs siteId={site.id} componentCount={componentCount} />
            {children}
        </div>
    );
}
