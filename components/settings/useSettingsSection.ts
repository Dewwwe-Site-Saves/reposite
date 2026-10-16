'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SettingsView } from '@/lib/db';
import { SECRET_MASK, type SmtpSecurity } from '@/lib/constants';

/** Every field as typed: the numbers stay strings until submit so a cleared input is not rewritten under the user's fingers. */
export interface SettingsFormValues {
    githubName: string;
    githubEmail: string;
    githubToken: string;
    spTenantId: string;
    spClientId: string;
    spCertThumbprint: string;
    spTenantName: string;
    spSiteName: string;
    spListName: string;
    spDateField: string;
    defaultCron: string;
    concurrency: string;
    retentionDays: string;
    notifyOnError: boolean;
    notifyTo: string;
    smtpHost: string;
    smtpPort: string;
    smtpSecurity: SmtpSecurity;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;
}

export function toFormValues(settings: SettingsView): SettingsFormValues {
    return {
        githubName: settings.githubName ?? '',
        githubEmail: settings.githubEmail ?? '',
        githubToken: settings.githubToken,
        spTenantId: settings.spTenantId ?? '',
        spClientId: settings.spClientId ?? '',
        spCertThumbprint: settings.spCertThumbprint ?? '',
        spTenantName: settings.spTenantName ?? '',
        spSiteName: settings.spSiteName ?? '',
        spListName: settings.spListName ?? '',
        spDateField: settings.spDateField ?? '',
        defaultCron: settings.defaultCron,
        concurrency: String(settings.concurrency),
        retentionDays: String(settings.retentionDays),
        notifyOnError: settings.notifyOnError,
        notifyTo: settings.notifyTo ?? '',
        smtpHost: settings.smtpHost ?? '',
        smtpPort: String(settings.smtpPort),
        smtpSecurity: settings.smtpSecurity as SmtpSecurity,
        smtpUser: settings.smtpUser ?? '',
        smtpPassword: settings.smtpPassword,
        smtpFrom: settings.smtpFrom ?? '',
    };
}

/** The SMTP block as the test route wants it. */
export function smtpBody(form: SettingsFormValues) {
    return {
        notifyTo: form.notifyTo,
        smtpHost: form.smtpHost,
        smtpPort: Number(form.smtpPort),
        smtpSecurity: form.smtpSecurity,
        smtpUser: form.smtpUser,
        smtpPassword: form.smtpPassword,
        smtpFrom: form.smtpFrom,
    };
}

export interface SettingsSectionForm {
    form: SettingsFormValues;
    update: <K extends keyof SettingsFormValues>(field: K, value: SettingsFormValues[K]) => void;
    /** Whether a secret of that name sits in the database: the field offers "Replace" only then. */
    stored: (field: 'githubToken' | 'smtpPassword') => boolean;
    dirty: boolean;
    saving: boolean;
    error: string | null;
    discard: () => void;
    submit: (event: React.FormEvent) => Promise<void>;
}

/**
 * One settings section's editing state.
 *
 * Every section sends the **whole** settings object even though it edits a slice of it:
 * `settingsSchema` has no partial mode and its optional fields default to null, so a field
 * left out of the body would be cleared rather than kept.
 */
export function useSettingsSection(settings: SettingsView): SettingsSectionForm {
    const router = useRouter();
    const [persisted, setPersisted] = useState(() => toFormValues(settings));
    const [form, setForm] = useState(persisted);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function update<K extends keyof SettingsFormValues>(field: K, value: SettingsFormValues[K]) {
        setForm((prev) => ({ ...prev, [field]: value }));
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setError(null);
        setSaving(true);
        try {
            const res = await fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...form,
                    ...smtpBody(form),
                    concurrency: Number(form.concurrency),
                    retentionDays: Number(form.retentionDays),
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Could not save the settings');
                return;
            }
            const next = toFormValues(data);
            setPersisted(next);
            setForm(next);
            router.refresh();
        } catch {
            setError('Could not save the settings');
        } finally {
            setSaving(false);
        }
    }

    return {
        form,
        update,
        stored: (field) => persisted[field] === SECRET_MASK,
        dirty: JSON.stringify(form) !== JSON.stringify(persisted),
        saving,
        error,
        discard: () => {
            setForm(persisted);
            setError(null);
        },
        submit,
    };
}
