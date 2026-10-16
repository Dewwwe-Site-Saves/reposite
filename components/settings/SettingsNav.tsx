'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import type { IconSvgElement } from '@hugeicons/react';
import {
    Book02Icon,
    Github01Icon,
    Notification01Icon,
    Time04Icon,
    UserIcon,
} from '@hugeicons/core-free-icons';
import { useJobStatus } from '@/components/JobStatusProvider';

/** `on` is configured and live, `off` is configured away, `busy` is work in progress. */
export type StatusTone = 'on' | 'off' | 'busy';

export interface SectionStatus {
    text: string;
    tone: StatusTone;
}

/** The statuses the server can work out; "Schedule & queue" counts active runs client-side. */
export interface SettingsNavStatus {
    github: SectionStatus;
    sharepoint: SectionStatus;
    notifications: SectionStatus;
}

const DOT: Record<StatusTone, string> = {
    on: 'bg-success',
    off: 'bg-muted-foreground',
    busy: 'bg-primary',
};

interface NavItem {
    href: string;
    label: string;
    icon: IconSvgElement;
    status?: SectionStatus;
}

export function SettingsNav({ status }: { status: SettingsNavStatus }) {
    const pathname = usePathname();
    const { running, pending } = useJobStatus();
    const active = running.length + pending.length;

    const groups: { label: string; items: NavItem[] }[] = [
        {
            label: 'Your account',
            items: [{ href: '/settings', label: 'Account', icon: UserIcon }],
        },
        {
            label: 'Instance',
            items: [
                {
                    href: '/settings/github',
                    label: 'GitHub',
                    icon: Github01Icon,
                    status: status.github,
                },
                {
                    href: '/settings/sharepoint',
                    label: 'SharePoint',
                    icon: Book02Icon,
                    status: status.sharepoint,
                },
                {
                    href: '/settings/schedule',
                    label: 'Schedule & queue',
                    icon: Time04Icon,
                    status:
                        active > 0
                            ? { text: `${active} running`, tone: 'busy' }
                            : { text: 'Idle', tone: 'off' },
                },
                {
                    href: '/settings/notifications',
                    label: 'Notifications',
                    icon: Notification01Icon,
                    status: status.notifications,
                },
            ],
        },
    ];

    return (
        <nav className="flex shrink-0 flex-col gap-3 lg:w-[260px]">
            {groups.map((group) => (
                <div
                    key={group.label}
                    className="flex flex-col gap-0.5 rounded-surface bg-card p-3"
                >
                    <p className="px-3 pt-1 pb-1.5 text-xs text-muted-foreground">{group.label}</p>
                    {group.items.map((item) => (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center justify-between gap-3 rounded-md p-2.5 text-xs no-underline transition-colors ${
                                pathname === item.href ? 'bg-popover' : 'hover:bg-popover/50'
                            }`}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <HugeiconsIcon icon={item.icon} size={16} className="shrink-0" />
                                <span className="truncate">{item.label}</span>
                            </span>
                            {item.status && (
                                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                                    <span
                                        className={`size-1.5 rounded-full ${DOT[item.status.tone]}`}
                                    />
                                    {item.status.text}
                                </span>
                            )}
                        </Link>
                    ))}
                </div>
            ))}
        </nav>
    );
}
