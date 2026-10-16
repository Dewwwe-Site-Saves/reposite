'use client';

import { useState } from 'react';
import { UserIcon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/settings/FormError';
import { SettingsSection } from '@/components/settings/SettingsSection';

/** Account section of Settings: password change for the signed-in user. */
export function PasswordForm({ email }: { email: string }) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSaved(false);
        if (newPassword !== passwordConfirmation) {
            setError('Passwords do not match');
            return;
        }
        setSaving(true);
        try {
            const res = await fetch('/api/auth/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword, passwordConfirmation }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Could not change the password');
                return;
            }
            setCurrentPassword('');
            setNewPassword('');
            setPasswordConfirmation('');
            setSaved(true);
        } catch {
            setError('Could not change the password');
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={UserIcon}
                title="Account"
                description={
                    <>
                        Signed in as {email}. Lost password: run{' '}
                        <code className="text-xs">npx tsx scripts/reset-password.ts {email}</code>{' '}
                        on the server.
                    </>
                }
                footer={
                    <>
                        <span className="text-xs text-muted-foreground">
                            {saved
                                ? 'Password changed.'
                                : 'At least 12 characters. You stay signed in.'}
                        </span>
                        <Button type="submit" variant="secondary" size="sm" disabled={saving}>
                            {saving ? 'Changing...' : 'Change password'}
                        </Button>
                    </>
                }
            >
                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="currentPassword">Current password</Label>
                        <Input
                            id="currentPassword"
                            size="lg"
                            type="password"
                            autoComplete="current-password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="newPassword">New password</Label>
                        <Input
                            id="newPassword"
                            size="lg"
                            type="password"
                            autoComplete="new-password"
                            minLength={12}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="newPasswordConfirmation">Confirm</Label>
                        <Input
                            id="newPasswordConfirmation"
                            size="lg"
                            type="password"
                            autoComplete="new-password"
                            minLength={12}
                            value={passwordConfirmation}
                            onChange={(e) => setPasswordConfirmation(e.target.value)}
                            required
                        />
                    </div>
                </div>
            </SettingsSection>
        </form>
    );
}
