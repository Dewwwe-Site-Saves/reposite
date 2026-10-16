import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSettings, getSite, listBackups } from '@/lib/db';
import { backupsQuerySchema, parseId } from '@/lib/validation';
import { RunBackupButton } from '@/components/BackupActions';
import { BackupHistory } from '@/components/BackupHistory';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SiteDetailActions } from './actions';

export const dynamic = 'force-dynamic';

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) notFound();

    const [backups, settings] = await Promise.all([
        listBackups(backupsQuerySchema.parse({ siteId: site.id, pageSize: 20 })),
        getSettings(),
    ]);

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
                action={
                    <div className="flex gap-2">
                        <RunBackupButton siteId={site.id} domain={site.domain} size="default" />
                        <SiteDetailActions siteId={site.id} />
                    </div>
                }
            />

            <div className="space-y-6">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-base">Configuration</CardTitle>
                        <Link
                            href={`/sites/${site.id}/edit`}
                            className="text-sm text-primary hover:underline"
                        >
                            Edit
                        </Link>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-8 text-sm">
                            <div>
                                <span className="text-muted-foreground">Protocol</span>
                                <p className="font-medium">{site.protocol.toUpperCase()}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Host</span>
                                <p className="font-medium">
                                    {site.host}:{site.port}
                                </p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Username</span>
                                <p className="font-medium">{site.username}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Web root</span>
                                <p className="font-medium">{site.webRootPath || '/'}</p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Repository</span>
                                <p className="font-medium">
                                    <a
                                        href={site.repoUrl.replace(/\.git$/, '')}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary hover:underline"
                                    >
                                        {site.repo}
                                    </a>
                                </p>
                            </div>
                            <div>
                                <span className="text-muted-foreground">Schedule</span>
                                <p className="font-medium font-mono text-xs">
                                    {site.cronSchedule ?? `Global (${settings.defaultCron})`}
                                </p>
                            </div>
                            {site.spListItemId && (
                                <div>
                                    <span className="text-muted-foreground">SharePoint ID</span>
                                    <p className="font-medium">{site.spListItemId}</p>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Backup History</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        {backups.items.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">
                                No backups yet. Click &quot;Run Backup&quot; to start.
                            </div>
                        ) : (
                            <BackupHistory
                                backups={backups.items}
                                showDomain={false}
                                siteId={site.id}
                            />
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
