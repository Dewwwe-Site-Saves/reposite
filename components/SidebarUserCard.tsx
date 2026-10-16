'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { Logout01Icon } from '@hugeicons/core-free-icons';
import { Avatar } from '@/components/Avatar';
import type { SidebarUser } from '@/components/Sidebar';

export function SidebarUserCard({ user }: { user: SidebarUser }) {
    const router = useRouter();
    const [signingOut, setSigningOut] = useState(false);

    async function handleSignOut() {
        setSigningOut(true);
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            router.push('/login');
            router.refresh();
        }
    }

    return (
        <div className="flex items-center gap-2 rounded-md bg-background p-1">
            <Avatar email={user.email} />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={user.email}>
                    {user.email.split('@')[0]}
                </p>
                <p className="truncate text-xs capitalize opacity-70">{user.role}</p>
            </div>
            <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                aria-label="Sign out"
                title="Sign out"
                className="mr-1 shrink-0 opacity-70 transition-opacity hover:opacity-100 disabled:opacity-40"
            >
                <HugeiconsIcon icon={Logout01Icon} size={16} />
            </button>
        </div>
    );
}
