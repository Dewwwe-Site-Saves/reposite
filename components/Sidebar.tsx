'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Clock01Icon,
    DashboardSquare01Icon,
    GlobeIcon,
    Settings01Icon,
} from '@hugeicons/core-free-icons';
import { SidebarStatus } from '@/components/SidebarStatus';
import { SidebarUserCard } from '@/components/SidebarUserCard';

export interface SidebarUser {
    email: string;
    role: string;
}

const LINKS = [
    { href: '/', label: 'Dashboard', icon: DashboardSquare01Icon },
    { href: '/sites', label: 'Sites', icon: GlobeIcon },
    { href: '/history', label: 'History', icon: Clock01Icon },
    { href: '/settings', label: 'Settings', icon: Settings01Icon },
];

export function Sidebar({
    user,
    siteCount,
    open,
    onClose,
}: {
    user: SidebarUser;
    siteCount: number;
    open: boolean;
    onClose: () => void;
}) {
    const pathname = usePathname();

    return (
        <nav
            className={`
            fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col justify-between
            overflow-y-auto bg-sidebar text-sidebar-foreground
            transition-transform duration-200 ease-in-out
            md:static md:h-full md:translate-x-0 md:rounded-surface
            ${open ? 'translate-x-0' : '-translate-x-full'}
        `}
        >
            <div>
                <div className="flex items-center gap-2 p-5">
                    {/* A fixed 32px mark: nothing for next/image to optimise. */}
                    <img src="/logo.svg" alt="" width={32} height={32} className="rounded-md" />
                    <span className="text-lg font-semibold tracking-[-0.01em]">Reposite</span>
                </div>

                <div className="flex flex-col gap-1 px-3 py-2">
                    {LINKS.map((link) => {
                        const isActive =
                            link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);

                        return (
                            <Link
                                key={link.href}
                                href={link.href}
                                onClick={onClose}
                                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm no-underline transition-colors ${
                                    isActive
                                        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                                        : 'hover:bg-sidebar-accent'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <HugeiconsIcon icon={link.icon} size={16} />
                                    {link.label}
                                </span>
                                {link.href === '/sites' && siteCount > 0 && (
                                    <span className="rounded-sm bg-sidebar-accent px-2 py-0.5 text-xs text-sidebar-accent-foreground">
                                        {siteCount}
                                    </span>
                                )}
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div className="flex flex-col gap-3 p-3">
                <SidebarStatus />
                <SidebarUserCard user={user} />
            </div>
        </nav>
    );
}
