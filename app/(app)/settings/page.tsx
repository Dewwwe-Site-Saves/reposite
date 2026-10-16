import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PasswordForm } from '@/components/settings/PasswordForm';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account settings' };

export default async function AccountSettingsPage() {
    const user = await getCurrentUser();
    if (!user) redirect('/login');

    return <PasswordForm email={user.email} />;
}
