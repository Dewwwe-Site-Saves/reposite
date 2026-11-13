'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CheckmarkCircle02Icon, Table01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SecretField } from '@/components/settings/SecretField';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { gristBody, useSettingsSection } from '@/components/settings/useSettingsSection';
import type { SettingsView } from '@/lib/db';
import type { GristCheck, TableCheck } from '@/lib/grist/check';

const PAIR = 'grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2';

const FAILED: GristCheck = {
    ok: false,
    error: 'Test failed',
    docName: null,
    sites: null,
    components: null,
    matching: null,
};

export function GristSection({ settings }: { settings: SettingsView }) {
    const { form, update, stored, dirty, saving, error, discard, submit } =
        useSettingsSection(settings);
    const [testing, setTesting] = useState(false);
    const [test, setTest] = useState<GristCheck | null>(null);

    async function handleTest() {
        setTesting(true);
        setTest(null);
        try {
            const res = await fetch('/api/settings/test-grist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(gristBody(form)),
            });
            const data = await res.json().catch(() => ({}));
            setTest(res.ok ? data : { ...FAILED, error: data.error || FAILED.error });
        } catch {
            setTest(FAILED);
        } finally {
            setTesting(false);
        }
    }

    const keyKnown = Boolean(form.gristApiKey) || stored('gristApiKey');
    const testable = Boolean(form.gristUrl && form.gristDocId && form.gristSitesTable) && keyKnown;

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Table01Icon}
                title="Grist"
                description="Pushes the state of each site to a Grist document after every backup and every inventory: one row per site, matched on its domain, and one row per installed component. Only the columns that exist are written, and only the cells that changed. Leave the server empty to disable."
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
                                {test.ok
                                    ? `Ready to sync with "${test.docName}"`
                                    : (test.error ?? 'Not ready, see the tables above.')}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                Reads the document with the values above, without writing anything.
                            </span>
                        )}
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleTest}
                            disabled={testing || !testable}
                        >
                            {testing ? 'Testing...' : 'Test connection'}
                        </Button>
                    </>
                }
            >
                <div className={PAIR}>
                    <Field
                        id="gristUrl"
                        label="Server URL"
                        placeholder="https://grist.example.com"
                        hint="Without /api. The API key must reach Grist itself: when a login proxy protects the public address, use the internal one."
                        value={form.gristUrl}
                        onChange={(e) => update('gristUrl', e.target.value)}
                    />
                    <Field
                        id="gristDocId"
                        label="Document ID"
                        hint="In Grist: Document settings, API, Document ID."
                        value={form.gristDocId}
                        onChange={(e) => update('gristDocId', e.target.value)}
                    />
                </div>
                <SecretField
                    id="gristApiKey"
                    label="API Key (Encrypted)"
                    noun="key"
                    value={form.gristApiKey}
                    stored={stored('gristApiKey')}
                    onChange={(value) => update('gristApiKey', value)}
                />
                <div className={PAIR}>
                    <Field
                        id="gristSitesTable"
                        label="Sites table"
                        placeholder="Sites"
                        hint={
                            <>
                                Table ID. Needs a <code>Domain</code> column; a site without a row
                                gets one.
                            </>
                        }
                        value={form.gristSitesTable}
                        onChange={(e) => update('gristSitesTable', e.target.value)}
                    />
                    <Field
                        id="gristComponentsTable"
                        label="Components table"
                        placeholder="Components"
                        hint={
                            <>
                                Table ID, optional. Needs <code>Site</code> (a reference to the
                                sites table), <code>Type</code> and <code>Slug</code>.
                            </>
                        }
                        value={form.gristComponentsTable}
                        onChange={(e) => update('gristComponentsTable', e.target.value)}
                    />
                </div>

                {test && (test.sites || test.components || test.matching) && (
                    <ul className="space-y-1 text-xs">
                        {test.sites && <TableLine check={test.sites} />}
                        {test.components && <TableLine check={test.components} />}
                        {test.matching && (
                            <li className="flex flex-wrap gap-x-2">
                                <span className="font-mono">Matching</span>
                                <span className="text-muted-foreground">
                                    {test.matching.matched} site(s) with a row
                                    {test.matching.unmatched.length > 0 &&
                                        `, added at the first sync: ${test.matching.unmatched.join(', ')}`}
                                </span>
                                {test.matching.ambiguous.length > 0 && (
                                    <span className="text-destructive">
                                        several rows for {test.matching.ambiguous.join(', ')}
                                    </span>
                                )}
                            </li>
                        )}
                    </ul>
                )}
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}

/** One table of the check: what stops the sync in the destructive colour, what is merely not written in the muted one. */
function TableLine({ check }: { check: TableCheck }) {
    const blocking =
        check.error ??
        (check.missingRequired.length > 0 ? `missing ${check.missingRequired.join(', ')}` : null);

    return (
        <li className="flex flex-wrap gap-x-2">
            <span className="font-mono">{check.table}</span>
            {blocking && <span className="text-destructive">{blocking}</span>}
            {!check.error && (
                <span className="text-muted-foreground">
                    {check.missing.length > 0
                        ? `not written, no such column: ${check.missing.join(', ')}`
                        : check.missingRequired.length === 0 && 'every column found'}
                </span>
            )}
        </li>
    );
}
