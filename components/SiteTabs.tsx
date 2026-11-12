'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** The tabs of a site page, one route each like the settings sections. Only the tabs that have content exist. */
export function SiteTabs({ siteId, componentCount }: { siteId: number; componentCount: number }) {
    const pathname = usePathname();
    const base = `/sites/${siteId}`;
    const tabs: { href: string; label: string; count?: number }[] = [
        { href: base, label: 'Overview' },
        { href: `${base}/inventory`, label: 'Inventory', count: componentCount },
    ];

    return (
        <nav className="flex gap-1" aria-label="Site sections">
            {tabs.map((tab) => {
                const current = pathname === tab.href;
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        aria-current={current ? 'page' : undefined}
                        className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm no-underline transition-colors ${
                            current ? 'bg-popover' : 'text-muted-foreground hover:bg-popover/50'
                        }`}
                    >
                        {tab.label}
                        {tab.count !== undefined && tab.count > 0 && (
                            <span className="text-xs text-muted-foreground">{tab.count}</span>
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}
