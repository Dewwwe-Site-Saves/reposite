'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface RouteTab {
    href: string;
    label: string;
    /** Shown next to the label when above zero. */
    count?: number;
}

/** Tabs that are routes, like the settings sections: the layout of a group of pages renders them once. */
export function RouteTabs({ tabs, label }: { tabs: RouteTab[]; label: string }) {
    const pathname = usePathname();

    return (
        <nav className="flex gap-1" aria-label={label}>
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
