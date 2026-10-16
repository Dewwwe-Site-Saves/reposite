'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CheckmarkCircle02Icon, Github01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/settings/Field';
import { FormError } from '@/components/settings/FormError';
import { SecretField } from '@/components/settings/SecretField';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { UnsavedBar } from '@/components/settings/UnsavedBar';
import { useSettingsSection } from '@/components/settings/useSettingsSection';
import type { SettingsView } from '@/lib/db';

interface GithubTestResult {
    ok: boolean;
    login: string | null;
    error: string | null;
    repos: {
        domain: string;
        repo: string;
        ok: boolean;
        private: boolean | null;
        error: string | null;
    }[];
}

export function GithubSection({ settings }: { settings: SettingsView }) {
    const { form, update, stored, dirty, saving, error, discard, submit } =
        useSettingsSection(settings);
    const [testing, setTesting] = useState(false);
    const [test, setTest] = useState<GithubTestResult | null>(null);

    async function handleTest() {
        setTesting(true);
        setTest(null);
        try {
            const res = await fetch('/api/settings/test-github', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ githubToken: form.githubToken }),
            });
            const data = await res.json().catch(() => ({}));
            setTest(
                res.ok
                    ? data
                    : { ok: false, login: null, error: data.error || 'Test failed', repos: [] },
            );
        } catch {
            setTest({ ok: false, login: null, error: 'Test failed', repos: [] });
        } finally {
            setTesting(false);
        }
    }

    const tokenKnown = Boolean(form.githubToken) || stored('githubToken');

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <FormError message={error} />}

            <SettingsSection
                icon={Github01Icon}
                title="GitHub Integration"
                description="Fine-grained personal access token with contents read/write permissions on the configured repositories. Stored encrypted, used for pushes and releases."
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
                                    ? `Connection verified${test.login ? ` as ${test.login}` : ''}`
                                    : (test.error ?? 'Token rejected.')}
                            </span>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                Checks the token above, or the stored one, against every site&apos;s
                                repository.
                            </span>
                        )}
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleTest}
                            disabled={testing || !tokenKnown}
                        >
                            {testing ? 'Testing...' : 'Test token'}
                        </Button>
                    </>
                }
            >
                <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                    <Field
                        id="githubName"
                        label="Author name"
                        placeholder="Reposite"
                        value={form.githubName}
                        onChange={(e) => update('githubName', e.target.value)}
                    />
                    <Field
                        id="githubEmail"
                        label="Author email"
                        placeholder="backups@example.com"
                        value={form.githubEmail}
                        onChange={(e) => update('githubEmail', e.target.value)}
                    />
                </div>
                <SecretField
                    id="githubToken"
                    label="Personal Access Token (Encrypted)"
                    noun="token"
                    placeholder="github_pat_..."
                    value={form.githubToken}
                    stored={stored('githubToken')}
                    onChange={(value) => update('githubToken', value)}
                />
                {test && test.repos.length > 0 && (
                    <ul className="space-y-1 text-xs">
                        {test.repos.map((repo) => (
                            <li key={repo.domain} className="flex flex-wrap gap-x-2">
                                <span className="font-mono" title={repo.domain}>
                                    {repo.repo}
                                </span>
                                <span
                                    className={
                                        repo.ok ? 'text-muted-foreground' : 'text-destructive'
                                    }
                                >
                                    {repo.ok
                                        ? repo.private
                                            ? 'push access, private'
                                            : 'push access, PUBLIC repository'
                                        : repo.error}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {test?.login && test.repos.length === 0 && (
                    <p className="text-xs text-muted-foreground">No site configured yet.</p>
                )}
            </SettingsSection>

            {dirty && <UnsavedBar onDiscard={discard} saving={saving} />}
        </form>
    );
}
