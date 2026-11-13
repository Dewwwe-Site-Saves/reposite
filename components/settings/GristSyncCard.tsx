'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseSync01Icon } from '@hugeicons/core-free-icons';
import { LocalDateTime } from '@/components/LocalDateTime';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { SummaryBar } from '@/components/settings/SummaryBar';

export interface GristSiteSync {
    id: number;
    domain: string;
    /** ISO 8601, null when the site was never pushed. */
    syncedAt: string | null;
    /** Why the last attempt failed, null when it went through. */
    error: string | null;
}

interface SyncResponse {
    ok: boolean;
    results: { domain: string; error: string | null; created: boolean }[];
}

/** Where the pushes stand, from what each site row keeps of its last one, and the button that pushes every site now with the stored configuration. */
export function GristSyncCard({
    configured,
    sites,
}: {
    configured: boolean;
    sites: GristSiteSync[];
}) {
    const router = useRouter();
    const [syncing, setSyncing] = useState(false);
    const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

    async function handleSync() {
        setSyncing(true);
        setOutcome(null);
        try {
            const res = await fetch('/api/grist/sync', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setOutcome({ ok: false, text: data.error || 'Sync failed' });
                return;
            }
            const { results } = data as SyncResponse;
            const failed = results.filter((result) => result.error !== null).length;
            const added = results.filter((result) => result.created).length;
            setOutcome({
                ok: failed === 0,
                text:
                    `${results.length - failed} of ${results.length} site(s) pushed` +
                    (added > 0 ? `, ${added} row(s) added` : '') +
                    (failed > 0 ? `, ${failed} failed` : ''),
            });
            router.refresh();
        } catch {
            setOutcome({ ok: false, text: 'Sync failed' });
        } finally {
            setSyncing(false);
        }
    }

    const failing = sites.filter((site) => site.error !== null);
    const pushed = sites.filter((site) => site.syncedAt !== null);
    const last = pushed
        .map((site) => site.syncedAt!)
        .sort()
        .at(-1);

    return (
        <SettingsSection
            icon={DatabaseSync01Icon}
            title="Sync status"
            description="A site is pushed at the end of each of its backups and inventories. A push that fails is made up for by the next one, since each carries the whole state of the site."
            footer={
                <>
                    <span
                        className={`text-xs ${outcome ? (outcome.ok ? 'text-success' : 'text-destructive') : 'text-muted-foreground'}`}
                    >
                        {outcome?.text ??
                            (configured
                                ? 'Pushes every site with the saved settings: the first fill of a document, or a catch-up.'
                                : 'Save a server, a key, a document and a sites table first.')}
                    </span>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleSync}
                        disabled={syncing || !configured || sites.length === 0}
                    >
                        {syncing ? 'Syncing...' : 'Sync all now'}
                    </Button>
                </>
            }
        >
            <SummaryBar
                items={[
                    { label: 'Pushed', value: `${pushed.length} of ${sites.length} site(s)` },
                    { label: 'Last push', value: last ? <LocalDateTime value={last} /> : 'never' },
                    { label: 'Failing', value: failing.length },
                ]}
            />
            {failing.length > 0 && (
                <ul className="space-y-1 text-xs">
                    {failing.map((site) => (
                        <li key={site.id} className="flex flex-wrap gap-x-2">
                            <span className="font-mono">{site.domain}</span>
                            <span className="text-destructive">{site.error}</span>
                        </li>
                    ))}
                </ul>
            )}
        </SettingsSection>
    );
}
