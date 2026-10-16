'use client';

import { Book02Icon } from '@hugeicons/core-free-icons';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { useSettingsSection } from '@/components/settings/useSettingsSection';
import type { SettingsView } from '@/lib/db';

const PAIR = 'grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2';

export function SharePointSection({ settings }: { settings: SettingsView }) {
    const { form, update, dirty, saving, error, discard, submit } = useSettingsSection(settings);

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Book02Icon}
                title="SharePoint"
                description={
                    <>
                        Updates a date field of a list item after each successful backup. The
                        certificate private key goes to{' '}
                        <code className="text-xs">$DATA_DIR/sp-certificates/key.pem</code>. Leave
                        everything empty to disable.
                    </>
                }
            >
                <div className={PAIR}>
                    <Field
                        id="spTenantId"
                        label="Tenant ID"
                        value={form.spTenantId}
                        onChange={(e) => update('spTenantId', e.target.value)}
                    />
                    <Field
                        id="spClientId"
                        label="App (client) ID"
                        value={form.spClientId}
                        onChange={(e) => update('spClientId', e.target.value)}
                    />
                </div>

                <div className={PAIR}>
                    <Field
                        id="spCertThumbprint"
                        label="Certificate"
                        hint="Thumbprint of the certificate registered on the app."
                        value={form.spCertThumbprint}
                        onChange={(e) => update('spCertThumbprint', e.target.value)}
                    />
                    <Field
                        id="spTenantName"
                        label="Tenant name"
                        placeholder="contoso"
                        value={form.spTenantName}
                        onChange={(e) => update('spTenantName', e.target.value)}
                    />
                </div>

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
                    <Field
                        id="spSiteName"
                        label="Site name"
                        value={form.spSiteName}
                        onChange={(e) => update('spSiteName', e.target.value)}
                    />
                    <Field
                        id="spListName"
                        label="List name"
                        value={form.spListName}
                        onChange={(e) => update('spListName', e.target.value)}
                    />
                    <Field
                        id="spDateField"
                        label="Date field"
                        hint="Internal name of the column."
                        value={form.spDateField}
                        onChange={(e) => update('spDateField', e.target.value)}
                    />
                </div>
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}
