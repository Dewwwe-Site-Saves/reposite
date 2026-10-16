'use client';

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Book02Icon,
    Clock01Icon,
    Menu01Icon,
    Notification01Icon,
    Search01Icon,
} from '@hugeicons/core-free-icons';
import { Avatar } from '@/components/Avatar';
import { UtcClock } from '@/components/UtcClock';
import type { SidebarUser } from '@/components/Sidebar';

const DOCS_URL = 'https://github.com/Dewwwe-Site-Saves/reposite#readme';

/** Search and notifications are drawn but inert: neither has a backend yet. */
export function AppHeader({ user, onMenuClick }: { user: SidebarUser; onMenuClick: () => void }) {
    return (
        <header className="flex shrink-0 items-center justify-between gap-3 rounded-md bg-background px-3 py-2 backdrop-blur-[12px]">
            <button
                type="button"
                onClick={onMenuClick}
                aria-label="Open menu"
                className="shrink-0 text-muted-foreground hover:text-foreground md:hidden"
            >
                <HugeiconsIcon icon={Menu01Icon} size={20} />
            </button>

            <button
                type="button"
                disabled
                aria-disabled
                title="Search is not wired up yet"
                className="hidden min-w-0 flex-1 cursor-default items-center gap-3 rounded-md bg-card px-3 py-1.5 text-left sm:flex"
            >
                <HugeiconsIcon
                    icon={Search01Icon}
                    size={14}
                    className="shrink-0 text-muted-foreground"
                />
                <span className="truncate text-sm text-muted-foreground">
                    Search sites, backups, schedules...
                </span>
                <span className="ml-auto shrink-0 rounded-sm bg-popover px-2 py-1 text-xs text-muted-foreground">
                    ⌘K
                </span>
            </button>

            <div className="flex flex-1 items-center justify-end gap-3">
                <span className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
                    <HugeiconsIcon icon={Clock01Icon} size={13} />
                    <UtcClock />
                </span>

                <Link
                    href={DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs text-primary no-underline"
                >
                    <HugeiconsIcon icon={Book02Icon} size={16} />
                    Docs
                </Link>

                <button
                    type="button"
                    disabled
                    aria-disabled
                    title="Notifications are not wired up yet"
                    className="relative cursor-default rounded-md bg-secondary px-2 py-1 text-primary"
                >
                    <HugeiconsIcon icon={Notification01Icon} size={16} />
                </button>

                <Link href="/settings" title={user.email} className="shrink-0 no-underline">
                    <Avatar email={user.email} />
                </Link>
            </div>
        </header>
    );
}
