'use client';

import { useState } from 'react';
import { useJobStatus } from '@/components/JobStatusProvider';
import { LogModal } from '@/components/LogModal';
import { Button } from '@/components/ui/button';

export function RunBackupButton({
    siteId,
    domain,
    size = 'sm',
}: {
    siteId: number;
    domain: string;
    size?: 'sm' | 'default';
}) {
    const [showModal, setShowModal] = useState(false);

    return (
        <>
            <Button variant="outline" size={size} onClick={() => setShowModal(true)}>
                Run Backup
            </Button>
            {showModal && (
                <LogModal
                    mode="run"
                    siteId={siteId}
                    domain={domain}
                    onClose={() => setShowModal(false)}
                />
            )}
        </>
    );
}

/** Queues every enabled site. Disabled while anything is active: the queue refuses a second backup per site anyway. */
export function RunAllButton() {
    const { active, refresh } = useJobStatus();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleRunAll() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Could not queue the backups');
            }
            await refresh();
        } catch {
            setError('Could not queue the backups');
        } finally {
            setSubmitting(false);
        }
    }

    const busy = submitting || active.length > 0;
    return (
        <div className="flex items-center gap-3">
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button onClick={handleRunAll} disabled={busy}>
                {active.length > 0 ? 'Running...' : submitting ? 'Queuing...' : 'Backup All'}
            </Button>
        </div>
    );
}
