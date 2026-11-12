'use client';

import { useState } from 'react';
import { useJobStatus } from '@/components/JobStatusProvider';
import { Button } from '@/components/ui/button';

/** Queues an inventory of one site. Disabled while the site has a job of any kind: the queue would refuse a second one. The page refreshes by itself when the run ends, through `JobStatusProvider`. */
export function RunInventoryButton({ siteId }: { siteId: number }) {
    const { active, refresh } = useJobStatus();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleRun() {
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ kind: 'inventory', siteIds: [siteId] }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Could not queue the inventory');
            }
            await refresh();
        } catch {
            setError('Could not queue the inventory');
        } finally {
            setSubmitting(false);
        }
    }

    const current = active.find((job) => job.siteId === siteId);
    return (
        <div className="flex items-center gap-3">
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button
                variant="outline"
                onClick={handleRun}
                disabled={submitting || current !== undefined}
            >
                {current
                    ? current.kind === 'inventory'
                        ? 'Reading...'
                        : 'Backup running...'
                    : submitting
                      ? 'Queuing...'
                      : 'Run inventory'}
            </Button>
        </div>
    );
}
