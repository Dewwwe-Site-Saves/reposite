import type { Metadata } from 'next';
import Link from 'next/link';
import { LocalDateTime } from '@/components/LocalDateTime';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { listSiteInventories } from '@/lib/db';
import { cmsLabel } from '@/lib/format';
import { newestVersion } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Inventory' };

/** One row per site: its CMS, how many components it carries and when that was read. A core version older than the newest one seen for the same CMS stands out. */
export default async function InventorySitesPage() {
    const sites = await listSiteInventories();
    const newestCore = new Map<string, string | null>();
    for (const site of sites) {
        if (!site.cms || newestCore.has(site.cms)) continue;
        newestCore.set(
            site.cms,
            newestVersion(sites.filter((s) => s.cms === site.cms).map((s) => s.cmsVersion)),
        );
    }

    return (
        <Card>
            <CardContent className="p-0">
                {sites.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">No site yet.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Site</TableHead>
                                    <TableHead>CMS</TableHead>
                                    <TableHead>Plugins</TableHead>
                                    <TableHead className="hidden sm:table-cell">Themes</TableHead>
                                    <TableHead>Last read</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sites.map((site) => {
                                    const behind =
                                        site.cms !== null &&
                                        site.cmsVersion !== null &&
                                        site.cmsVersion !== newestCore.get(site.cms);
                                    const mustUse = site.counts['mu-plugin'] ?? 0;
                                    return (
                                        <TableRow key={site.id}>
                                            <TableCell className="font-medium">
                                                <Link
                                                    href={`/sites/${site.id}/inventory`}
                                                    className="hover:underline"
                                                >
                                                    {site.domain}
                                                </Link>
                                            </TableCell>
                                            <TableCell>
                                                {site.cms && site.cmsVersion ? (
                                                    <span className={behind ? 'text-warning' : ''}>
                                                        {cmsLabel(site.cms)}{' '}
                                                        <span className="font-mono text-xs">
                                                            {site.cmsVersion}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                {site.inventoryAt ? (site.counts.plugin ?? 0) : '-'}
                                                {mustUse > 0 && ` + ${mustUse} must-use`}
                                            </TableCell>
                                            <TableCell className="hidden text-muted-foreground sm:table-cell">
                                                {site.inventoryAt ? (site.counts.theme ?? 0) : '-'}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground">
                                                <span className="flex items-center gap-2">
                                                    {site.inventoryAt ? (
                                                        <LocalDateTime
                                                            value={site.inventoryAt.toISOString()}
                                                        />
                                                    ) : (
                                                        'Never'
                                                    )}
                                                    {!site.inventoryEnabled && (
                                                        <Badge variant="secondary">Off</Badge>
                                                    )}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
