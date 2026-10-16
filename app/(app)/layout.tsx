import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { countSites } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

// Reads the database for the sidebar counter, so it cannot be prerendered.
export const dynamic = 'force-dynamic';

/** Everything behind the login: the proxy checked the cookie, this reads the user behind it. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const [user, siteCount] = await Promise.all([getCurrentUser(), countSites()]);
    if (!user) redirect('/login');

    return (
        <AppShell user={{ email: user.email, role: user.role }} siteCount={siteCount}>
            {children}
        </AppShell>
    );
}
