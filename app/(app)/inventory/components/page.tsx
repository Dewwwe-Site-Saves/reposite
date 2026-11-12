import type { Metadata } from 'next';
import { InventoryComponentsTable } from '@/components/InventoryComponentsTable';
import { Card, CardContent } from '@/components/ui/card';
import { listInstalledComponents } from '@/lib/db';
import { groupComponents } from '@/lib/inventory';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Inventory by component' };

/** One row per plugin or theme across the sites: which versions are installed, and on which site. */
export default async function InventoryComponentsPage() {
    const components = groupComponents(await listInstalledComponents());

    return (
        <Card>
            <CardContent className="p-0">
                {components.length === 0 ? (
                    <div className="py-16 text-center text-muted-foreground">
                        No inventory has been read yet.
                    </div>
                ) : (
                    <InventoryComponentsTable components={components} />
                )}
            </CardContent>
        </Card>
    );
}
