import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { RunInventoryButton } from '@/components/InventoryActions';
import { LocalDateTime } from '@/components/LocalDateTime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { ComponentType } from '@/lib/engine/inventory/types';
import { getLastInventoryJob, getSettings, getSite, listSiteComponents } from '@/lib/db';
import { COMPONENT_TYPE_LABELS, cmsLabel } from '@/lib/format';
import { parseId } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Site inventory' };

/** Inventory tab: what runs on the site as last read, complete or not shown at all. */
export default async function SiteInventoryPage({ params }: { params: Promise<{ id: string }> }) {
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) notFound();

    const [components, lastRun, settings] = await Promise.all([
        listSiteComponents(site.id),
        getLastInventoryJob(site.id),
        getSettings(),
    ]);
    // A failed run leaves the previous inventory in place: say so when what is shown is older than the failure.
    const staleSince =
        lastRun?.status === 'error' &&
        lastRun.finishedAt &&
        (!site.inventoryAt || lastRun.finishedAt > site.inventoryAt)
            ? lastRun
            : null;
    const groups = (Object.keys(COMPONENT_TYPE_LABELS) as ComponentType[])
        .map((type) => ({ type, rows: components.filter((component) => component.type === type) }))
        .filter((group) => group.rows.length > 0);

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Inventory</CardTitle>
                    <RunInventoryButton siteId={site.id} />
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
                        <div>
                            <span className="text-muted-foreground">CMS</span>
                            <p className="font-medium">
                                {site.cms && site.cmsVersion
                                    ? `${cmsLabel(site.cms)} ${site.cmsVersion}`
                                    : 'Not read yet'}
                            </p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Last read</span>
                            <p className="font-medium">
                                {site.inventoryAt ? (
                                    <LocalDateTime value={site.inventoryAt.toISOString()} />
                                ) : (
                                    '-'
                                )}
                            </p>
                        </div>
                        <div>
                            <span className="text-muted-foreground">Schedule</span>
                            <p className="font-mono text-xs font-medium">
                                {site.inventoryEnabled
                                    ? (site.inventoryCronSchedule ??
                                      `Global (${settings.defaultInventoryCron})`)
                                    : 'Off'}
                            </p>
                        </div>
                    </div>
                    {staleSince && (
                        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                            The last inventory run failed
                            {staleSince.errorMessage ? `: ${staleSince.errorMessage}` : ''}. What is
                            shown below is the previous reading.
                        </div>
                    )}
                </CardContent>
            </Card>

            {groups.length === 0 ? (
                <Card>
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                        {site.inventoryEnabled
                            ? 'No inventory yet. It is read at the next backup, at the next scheduled inventory, or right now with "Run inventory".'
                            : 'The inventory is switched off for this site. It can still be read by hand with "Run inventory".'}
                    </CardContent>
                </Card>
            ) : (
                groups.map((group) => (
                    <Card key={group.type}>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {COMPONENT_TYPE_LABELS[group.type]}{' '}
                                <span className="text-sm font-normal text-muted-foreground">
                                    {group.rows.length}
                                </span>
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Name</TableHead>
                                            <TableHead className="hidden sm:table-cell">
                                                Slug
                                            </TableHead>
                                            <TableHead>Version</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {group.rows.map((component) => (
                                            <TableRow key={component.id}>
                                                <TableCell className="font-medium">
                                                    {component.name}
                                                </TableCell>
                                                <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                                                    {component.slug}
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">
                                                    {component.version ?? '-'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    );
}
