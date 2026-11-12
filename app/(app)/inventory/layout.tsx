import { RunAllInventoriesButton } from '@/components/InventoryActions';
import { PageHeader } from '@/components/PageHeader';
import { RouteTabs } from '@/components/RouteTabs';

/** Header and tabs of the cross-site inventory: the same stored inventories, by site or by component. */
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="space-y-6">
            <PageHeader
                title="Inventory"
                subtitle="What runs on every site, as last read from its files."
                action={<RunAllInventoriesButton />}
            />
            <RouteTabs
                label="Inventory views"
                tabs={[
                    { href: '/inventory', label: 'Sites' },
                    { href: '/inventory/components', label: 'Components' },
                ]}
            />
            {children}
        </div>
    );
}
