'use client';

import { useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { JobStatusProvider } from '@/components/JobStatusProvider';
import { Sidebar, type SidebarUser } from '@/components/Sidebar';

export function AppShell({
    user,
    siteCount,
    children,
}: {
    user: SidebarUser;
    siteCount: number;
    children: React.ReactNode;
}) {
    const [sidebarOpen, setSidebarOpen] = useState(false);

    return (
        <JobStatusProvider>
            {/* Viewport-high shell: the sidebar and the header stay put, only the main area scrolls. */}
            <div className="flex h-dvh gap-2.5 overflow-hidden bg-background p-2 md:p-4">
                {sidebarOpen && (
                    <div
                        className="fixed inset-0 z-30 bg-black/50 md:hidden"
                        onClick={() => setSidebarOpen(false)}
                    />
                )}

                <Sidebar
                    user={user}
                    siteCount={siteCount}
                    open={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <AppHeader user={user} onMenuClick={() => setSidebarOpen(true)} />
                    <main className="min-h-0 flex-1 overflow-y-auto p-3">{children}</main>
                </div>
            </div>
        </JobStatusProvider>
    );
}
