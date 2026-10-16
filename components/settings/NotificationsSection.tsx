'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    AlertCircleIcon,
    CheckmarkCircle02Icon,
    Notification01Icon,
} from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SecretField } from '@/components/settings/SecretField';
import { SelectField } from '@/components/settings/SelectField';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { ToggleRow } from '@/components/settings/ToggleRow';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { smtpBody, useSettingsSection } from '@/components/settings/useSettingsSection';
import { SMTP_SECURITIES, type SmtpSecurity } from '@/lib/constants';
import type { SettingsView } from '@/lib/db';

interface SmtpTestResult {
    ok: boolean;
    accepted: string[];
    rejected: string[];
    /** The server's final line, e.g. `250 2.0.0 OK queued as 4Xyz`. */
    response: string | null;
    error: string | null;
}

const FAILED_TEST: SmtpTestResult = {
    ok: false,
    accepted: [],
    rejected: [],
    response: null,
    error: 'Test failed',
};

const SECURITY_LABELS: Record<SmtpSecurity, string> = {
    tls: 'TLS (465)',
    starttls: 'STARTTLS (587)',
    none: 'None',
};

const PAIR = 'grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2';

export function NotificationsSection({ settings }: { settings: SettingsView }) {
    const { form, update, stored, dirty, saving, error, discard, submit } =
        useSettingsSection(settings);
    const [testing, setTesting] = useState(false);
    const [test, setTest] = useState<SmtpTestResult | null>(null);

    async function handleTest() {
        setTesting(true);
        setTest(null);
        try {
            const res = await fetch('/api/settings/test-smtp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(smtpBody(form)),
            });
            const data = await res.json().catch(() => ({}));
            setTest(res.ok ? data : { ...FAILED_TEST, error: data.error || FAILED_TEST.error });
        } catch {
            setTest(FAILED_TEST);
        } finally {
            setTesting(false);
        }
    }

    const smtpFilled = Boolean(form.smtpHost && form.smtpFrom && form.notifyTo);

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Notification01Icon}
                title="Notifications & SMTP Alerts"
                description="Alert dispatching for failed backups and system interruption alerts."
                footer={
                    <>
                        {test ? (
                            <span
                                className={`flex items-center gap-1.5 text-xs ${test.ok ? 'text-success' : 'text-destructive'}`}
                            >
                                <HugeiconsIcon
                                    icon={test.ok ? CheckmarkCircle02Icon : AlertCircleIcon}
                                    size={16}
                                />
                                {test.error
                                    ? test.error
                                    : test.ok
                                      ? `Test mail sent to ${test.accepted.join(', ')}`
                                      : `Refused for ${test.rejected.join(', ')}`}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                Sends a message to the recipients with the settings above, or the
                                stored password.
                            </span>
                        )}
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleTest}
                            disabled={testing || !smtpFilled}
                        >
                            {testing ? 'Sending...' : 'Test mail'}
                        </Button>
                    </>
                }
            >
                <ToggleRow
                    id="notifyOnError"
                    title="Failure Alerts"
                    description="Send immediate email when a backup task fails or errors out."
                    checked={form.notifyOnError}
                    onCheckedChange={(checked) => update('notifyOnError', checked)}
                />

                {/* Host, port and protocol keep the widths of the design: 413 / 180 / 219 of 876. */}
                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-[413fr_180fr_219fr]">
                    <Field
                        id="smtpHost"
                        label="Host"
                        placeholder="smtp.example.com"
                        value={form.smtpHost}
                        onChange={(e) => update('smtpHost', e.target.value)}
                    />
                    <Field
                        id="smtpPort"
                        label="Port"
                        type="number"
                        min={1}
                        max={65535}
                        required
                        value={form.smtpPort}
                        onChange={(e) => update('smtpPort', e.target.value)}
                    />
                    <SelectField
                        id="smtpSecurity"
                        label="Protocol"
                        value={form.smtpSecurity}
                        onChange={(e) => update('smtpSecurity', e.target.value as SmtpSecurity)}
                    >
                        {SMTP_SECURITIES.map((value) => (
                            <option key={value} value={value}>
                                {SECURITY_LABELS[value]}
                            </option>
                        ))}
                    </SelectField>
                </div>

                <div className={PAIR}>
                    <Field
                        id="smtpUser"
                        label="Username"
                        value={form.smtpUser}
                        onChange={(e) => update('smtpUser', e.target.value)}
                    />
                    <SecretField
                        id="smtpPassword"
                        label="Password"
                        noun="password"
                        value={form.smtpPassword}
                        stored={stored('smtpPassword')}
                        onChange={(value) => update('smtpPassword', value)}
                    />
                </div>

                <div className={PAIR}>
                    <Field
                        id="smtpFrom"
                        label="Sender"
                        placeholder="reposite@example.com"
                        value={form.smtpFrom}
                        onChange={(e) => update('smtpFrom', e.target.value)}
                    />
                    <Field
                        id="notifyTo"
                        label="Recipients"
                        hint="Several addresses separated by commas."
                        placeholder="you@example.com, ops@example.com"
                        value={form.notifyTo}
                        onChange={(e) => update('notifyTo', e.target.value)}
                    />
                </div>

                {test?.response && (
                    <p className="font-mono text-xs text-muted-foreground">{test.response}</p>
                )}
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}
