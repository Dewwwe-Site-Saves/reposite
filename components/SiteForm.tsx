'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SecretInput } from '@/components/SecretInput';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { ConnectionTestResult } from '@/lib/connection-test';
import type { SiteSummary } from '@/lib/db';
import { formatSize } from '@/lib/format';

interface SiteFormValues {
    domain: string;
    repo: string;
    repoUrl: string;
    protocol: 'ftp' | 'sftp';
    host: string;
    port: number;
    username: string;
    password: string;
    webRootPath: string;
    spListItemId: string;
    cronSchedule: string;
    enabled: boolean;
    inventoryCronSchedule: string;
    inventoryEnabled: boolean;
}

const SELECT_CLASS =
    'flex h-7 w-full rounded-md border border-input bg-input/20 px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30 md:text-xs/relaxed';

function defaults(defaultCron: string, defaultInventoryCron: string): SiteFormValues {
    return {
        domain: '',
        repo: '',
        repoUrl: '',
        protocol: 'ftp',
        host: '',
        port: 21,
        username: '',
        password: '',
        webRootPath: 'www',
        spListItemId: '',
        cronSchedule: defaultCron,
        enabled: true,
        inventoryCronSchedule: defaultInventoryCron,
        inventoryEnabled: true,
    };
}

function toFormValues(
    site: SiteSummary,
    defaultCron: string,
    defaultInventoryCron: string,
): SiteFormValues {
    return {
        domain: site.domain,
        repo: site.repo,
        repoUrl: site.repoUrl,
        protocol: site.protocol === 'sftp' ? 'sftp' : 'ftp',
        host: site.host,
        port: site.port,
        username: site.username,
        password: '',
        webRootPath: site.webRootPath,
        spListItemId: site.spListItemId ?? '',
        cronSchedule: site.cronSchedule ?? defaultCron,
        enabled: site.enabled,
        inventoryCronSchedule: site.inventoryCronSchedule ?? defaultInventoryCron,
        inventoryEnabled: site.inventoryEnabled,
    };
}

export function SiteForm({
    site,
    mode = 'create',
    defaultCron,
    defaultInventoryCron,
}: {
    site?: SiteSummary;
    mode?: 'create' | 'edit';
    /** `Settings.defaultCron`, what "Use global schedule" means today. */
    defaultCron: string;
    /** `Settings.defaultInventoryCron`, the same for the inventory. */
    defaultInventoryCron: string;
}) {
    const router = useRouter();
    const [form, setForm] = useState<SiteFormValues>(
        site
            ? toFormValues(site, defaultCron, defaultInventoryCron)
            : defaults(defaultCron, defaultInventoryCron),
    );
    const [useGlobalSchedule, setUseGlobalSchedule] = useState(!site?.cronSchedule);
    const [useGlobalInventorySchedule, setUseGlobalInventorySchedule] = useState(
        !site?.inventoryCronSchedule,
    );
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

    function update<K extends keyof SiteFormValues>(field: K, value: SiteFormValues[K]) {
        setForm((prev) => {
            const updated = { ...prev, [field]: value };
            // Auto-switch port when protocol changes
            if (field === 'protocol') {
                updated.port = value === 'sftp' ? 22 : 21;
            }
            return updated;
        });
        setTestResult(null);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError(null);
        setSaving(true);

        const payload = {
            ...form,
            spListItemId: form.spListItemId || null,
            cronSchedule: useGlobalSchedule ? null : form.cronSchedule,
            inventoryCronSchedule: useGlobalInventorySchedule ? null : form.inventoryCronSchedule,
        };

        try {
            const url = mode === 'create' ? '/api/sites' : `/api/sites/${site?.id}`;
            const method = mode === 'create' ? 'POST' : 'PUT';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'An error occurred');
                setSaving(false);
                return;
            }

            router.push(`/sites/${data.id}`);
            router.refresh();
        } catch {
            setError('Failed to save site');
            setSaving(false);
        }
    }

    async function handleTestConnection() {
        if (mode === 'create' && !form.password) {
            setTestResult({ ok: false, entries: [], error: 'Enter the password to test' });
            return;
        }
        setTesting(true);
        setTestResult(null);
        try {
            const url = mode === 'create' ? '/api/sites/test' : `/api/sites/${site?.id}/test`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    protocol: form.protocol,
                    host: form.host,
                    port: form.port,
                    username: form.username,
                    password: form.password,
                    webRootPath: form.webRootPath,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setTestResult({ ok: false, entries: [], error: data.error || 'Test failed' });
                return;
            }
            setTestResult(data);
        } catch {
            setTestResult({ ok: false, entries: [], error: 'Test failed' });
        } finally {
            setTesting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-6">
                {error && (
                    <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                        {error}
                    </div>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Site information</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="domain">Domain</Label>
                            <Input
                                id="domain"
                                value={form.domain}
                                onChange={(e) => update('domain', e.target.value)}
                                placeholder="mysite.com"
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="repo">Repository name</Label>
                            <Input
                                id="repo"
                                value={form.repo}
                                onChange={(e) => update('repo', e.target.value)}
                                placeholder="mysite"
                                required
                            />
                            <p className="text-xs text-muted-foreground">
                                Local folder of the clone under the data directory.
                            </p>
                        </div>
                        <div className="sm:col-span-2 space-y-2">
                            <Label htmlFor="repoUrl">Repository URL</Label>
                            <Input
                                id="repoUrl"
                                value={form.repoUrl}
                                onChange={(e) => update('repoUrl', e.target.value)}
                                placeholder="https://github.com/org/repo.git"
                                required
                            />
                            <p className="text-xs text-muted-foreground">
                                GitHub over HTTPS. The repository must exist and be private.
                            </p>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Connection</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="protocol">Protocol</Label>
                                <select
                                    id="protocol"
                                    value={form.protocol}
                                    onChange={(e) =>
                                        update(
                                            'protocol',
                                            e.target.value === 'sftp' ? 'sftp' : 'ftp',
                                        )
                                    }
                                    className={SELECT_CLASS}
                                >
                                    <option value="ftp">FTP</option>
                                    <option value="sftp">SFTP</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="host">Host</Label>
                                <Input
                                    id="host"
                                    value={form.host}
                                    onChange={(e) => update('host', e.target.value)}
                                    placeholder="ftp.mysite.com"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="port">Port</Label>
                                <Input
                                    id="port"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={form.port}
                                    onChange={(e) => update('port', parseInt(e.target.value) || 0)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="webRootPath">Web root path</Label>
                                <Input
                                    id="webRootPath"
                                    value={form.webRootPath}
                                    onChange={(e) => update('webRootPath', e.target.value)}
                                    placeholder="www"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Folder holding wp-config.php, relative to the login directory.
                                    Empty for the login directory itself.
                                </p>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="username">Username</Label>
                                <Input
                                    id="username"
                                    value={form.username}
                                    onChange={(e) => update('username', e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <SecretInput
                                    id="password"
                                    value={form.password}
                                    onChange={(value) => update('password', value)}
                                    placeholder={mode === 'edit' ? '(unchanged)' : ''}
                                    required={mode === 'create'}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleTestConnection}
                                disabled={testing || !form.host || !form.username}
                            >
                                {testing ? 'Connecting...' : 'Test connection'}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                                Connects and lists the web root. Up to 15 seconds.
                            </span>
                        </div>
                        {testResult && <ConnectionTestReport result={testResult} />}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Schedule & Options</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>Backup schedule</Label>
                                <p className="text-sm text-muted-foreground">
                                    Use the global schedule (
                                    <span className="font-mono text-xs">{defaultCron}</span>) or set
                                    a custom one
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                                <span>Global</span>
                                <Switch
                                    aria-label="Custom schedule"
                                    checked={!useGlobalSchedule}
                                    onCheckedChange={(checked) => setUseGlobalSchedule(!checked)}
                                />
                                <span>Custom</span>
                            </div>
                        </div>
                        {!useGlobalSchedule && (
                            <div className="space-y-2">
                                <Label htmlFor="cronSchedule">Cron expression</Label>
                                <Input
                                    id="cronSchedule"
                                    value={form.cronSchedule}
                                    onChange={(e) => update('cronSchedule', e.target.value)}
                                    placeholder={defaultCron}
                                    className="font-mono"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Example: 0 3 * * * = daily at 3 AM, 0 */6 * * * = every 6 hours
                                </p>
                            </div>
                        )}

                        <div className="flex items-center justify-between pt-2">
                            <div>
                                <Label>SharePoint list item ID</Label>
                                <p className="text-sm text-muted-foreground">
                                    Optional — for SharePoint list update after backup
                                </p>
                            </div>
                            <Input
                                className="w-24"
                                value={form.spListItemId}
                                onChange={(e) => update('spListItemId', e.target.value)}
                                placeholder="—"
                            />
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <div>
                                <Label>Scheduled backups</Label>
                                <p className="text-sm text-muted-foreground">
                                    When off, the site is only backed up by hand
                                </p>
                            </div>
                            <Switch
                                checked={form.enabled}
                                onCheckedChange={(checked) => update('enabled', checked)}
                            />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Inventory</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>Read the versions</Label>
                                <p className="text-sm text-muted-foreground">
                                    CMS, plugins and themes: at each backup from the synced files,
                                    and on the schedule below from the live site
                                </p>
                            </div>
                            <Switch
                                aria-label="Inventory"
                                checked={form.inventoryEnabled}
                                onCheckedChange={(checked) => update('inventoryEnabled', checked)}
                            />
                        </div>
                        {form.inventoryEnabled && (
                            <div className="flex items-center justify-between pt-2">
                                <div>
                                    <Label>Inventory schedule</Label>
                                    <p className="text-sm text-muted-foreground">
                                        Use the global schedule (
                                        <span className="font-mono text-xs">
                                            {defaultInventoryCron}
                                        </span>
                                        ) or set a custom one
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 text-sm">
                                    <span>Global</span>
                                    <Switch
                                        aria-label="Custom inventory schedule"
                                        checked={!useGlobalInventorySchedule}
                                        onCheckedChange={(checked) =>
                                            setUseGlobalInventorySchedule(!checked)
                                        }
                                    />
                                    <span>Custom</span>
                                </div>
                            </div>
                        )}
                        {form.inventoryEnabled && !useGlobalInventorySchedule && (
                            <div className="space-y-2">
                                <Label htmlFor="inventoryCronSchedule">Cron expression</Label>
                                <Input
                                    id="inventoryCronSchedule"
                                    value={form.inventoryCronSchedule}
                                    onChange={(e) =>
                                        update('inventoryCronSchedule', e.target.value)
                                    }
                                    placeholder={defaultInventoryCron}
                                    className="font-mono"
                                />
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="flex justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => router.back()}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? 'Saving...' : mode === 'create' ? 'Create Site' : 'Save Changes'}
                    </Button>
                </div>
            </div>
        </form>
    );
}

const PREVIEW_ENTRIES = 12;

function ConnectionTestReport({ result }: { result: ConnectionTestResult }) {
    if (!result.ok) {
        return (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {result.error ?? 'Connection failed'}
            </div>
        );
    }
    const hasWpConfig = result.entries.some((entry) => entry.name === 'wp-config.php');
    return (
        <div className="p-3 rounded-md bg-primary/10 border border-primary/20 text-sm space-y-2">
            <p>
                Connected. {result.entries.length} entr{result.entries.length === 1 ? 'y' : 'ies'}{' '}
                in the web root
                {hasWpConfig ? ', wp-config.php found.' : ', no wp-config.php: check the path.'}
            </p>
            {result.entries.length > 0 && (
                <ul className="font-mono text-xs text-muted-foreground columns-2 sm:columns-3">
                    {result.entries.slice(0, PREVIEW_ENTRIES).map((entry) => (
                        <li key={entry.name} className="truncate">
                            {entry.type === 'dir' ? `${entry.name}/` : entry.name}
                            {entry.type === 'file' && (
                                <span className="opacity-60"> {formatSize(entry.size)}</span>
                            )}
                        </li>
                    ))}
                    {result.entries.length > PREVIEW_ENTRIES && (
                        <li>… {result.entries.length - PREVIEW_ENTRIES} more</li>
                    )}
                </ul>
            )}
        </div>
    );
}
