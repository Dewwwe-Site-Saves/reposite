'use client';

import Link from 'next/link';
import { useJobStatus } from '@/components/JobStatusProvider';

/** The queue carries no step and no percentage, so the bar is indeterminate on purpose. */
export function SidebarStatus() {
    const { running, pending } = useJobStatus();
    const current = running[0] ?? pending[0];
    if (!current) return null;

    const others = running.length + pending.length - 1;
    const state = running.length > 0 ? 'Running' : 'Queued';

    return (
        <Link
            href="/history"
            className="block rounded-md bg-background p-3 no-underline transition-opacity hover:opacity-80"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs">ACTIVE BACKUP</span>
                <span className="relative flex size-2 shrink-0">
                    <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative size-2 rounded-full bg-primary" />
                </span>
            </div>
            <p className="mt-1 truncate text-xs" title={current.domain}>
                {current.domain}
            </p>
            <p className="text-xs opacity-70">
                {state}
                {others > 0 && ` · ${others} more`}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-sidebar-accent">
                <div className="h-full w-1/3 animate-progress rounded-full bg-primary" />
            </div>
        </Link>
    );
}
