'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJobStatus } from '@/components/JobStatusProvider';
import { LogModal } from '@/components/LogModal';
import { StatusBadge } from '@/components/StatusBadge';
import { Badge } from '@/components/ui/badge';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import type { JobKind } from '@/lib/constants';
import type { JobWithDomain } from '@/lib/db';
import { formatDuration, formatSize, optionLabels } from '@/lib/format';

const isActive = (status: string) => status === 'pending' || status === 'running';

type ModalState =
    | { mode: 'live'; jobId: number; domain: string; siteId: number }
    | { mode: 'history'; backup: JobWithDomain };

export function BackupHistory({
    backups,
    showDomain = true,
    kindFilter = 'backup',
    siteId,
    statusFilter,
}: {
    backups: JobWithDomain[];
    showDomain?: boolean;
    /** Only active jobs of this kind are added as extra rows, backups unless the list shows something else. */
    kindFilter?: JobKind | 'all';
    /** Only this site's active backups are added as extra rows. */
    siteId?: number;
    /** Only active backups in this status are added as extra rows. */
    statusFilter?: string;
}) {
    const { active } = useJobStatus();
    const [modal, setModal] = useState<ModalState | null>(null);
    const router = useRouter();

    // The row is the job: a pending or running row is followed live under its own id.
    function handleRowClick(backup: JobWithDomain) {
        if (isActive(backup.status)) {
            setModal({
                mode: 'live',
                jobId: backup.id,
                domain: backup.site.domain,
                siteId: backup.siteId,
            });
        } else {
            setModal({ mode: 'history', backup });
        }
    }

    // Active backups queued since this page was rendered, shown until the next server refresh brings their rows.
    const knownIds = new Set(backups.map((b) => b.id));
    const extraRows = active.filter(
        (j) =>
            !knownIds.has(j.id) &&
            (kindFilter === 'all' || j.kind === kindFilter) &&
            (siteId === undefined || j.siteId === siteId) &&
            (statusFilter === undefined || j.status === statusFilter),
    );

    return (
        <>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {showDomain && <TableHead>Site</TableHead>}
                            <TableHead>Status</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="hidden sm:table-cell">Duration</TableHead>
                            <TableHead className="hidden lg:table-cell">Options</TableHead>
                            <TableHead className="hidden sm:table-cell">Files</TableHead>
                            <TableHead className="hidden lg:table-cell">Dump</TableHead>
                            <TableHead>Commit</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {extraRows.map((job) => (
                            <TableRow
                                key={`active-${job.id}`}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() =>
                                    setModal({
                                        mode: 'live',
                                        jobId: job.id,
                                        domain: job.domain,
                                        siteId: job.siteId,
                                    })
                                }
                            >
                                {showDomain && (
                                    <TableCell className="font-medium">{job.domain}</TableCell>
                                )}
                                <TableCell>
                                    <StatusBadge status={job.status} />
                                </TableCell>
                                <TableCell className="text-muted-foreground">Now</TableCell>
                                <TableCell className="hidden sm:table-cell text-muted-foreground">
                                    -
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                    <OptionsCell
                                        kind={job.kind}
                                        fullDownload={false}
                                        skipGit={false}
                                    />
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-muted-foreground">
                                    -
                                </TableCell>
                                <TableCell className="hidden lg:table-cell text-muted-foreground">
                                    -
                                </TableCell>
                                <TableCell className="text-muted-foreground">-</TableCell>
                            </TableRow>
                        ))}
                        {backups.map((backup) => (
                            <TableRow
                                key={backup.id}
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => handleRowClick(backup)}
                            >
                                {showDomain && (
                                    <TableCell className="font-medium">
                                        {backup.site.domain}
                                    </TableCell>
                                )}
                                <TableCell>
                                    <StatusBadge status={backup.status} />
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {new Date(backup.startedAt ?? backup.queuedAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-muted-foreground">
                                    {backup.durationMs ? formatDuration(backup.durationMs) : '-'}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                    <OptionsCell
                                        kind={backup.kind}
                                        fullDownload={backup.fullDownload}
                                        skipGit={backup.skipGit}
                                    />
                                </TableCell>
                                <TableCell className="hidden sm:table-cell text-muted-foreground">
                                    {backup.filesDownloaded != null
                                        ? `${backup.filesDownloaded} / ${backup.filesDownloaded + (backup.filesUnchanged ?? 0)}`
                                        : '-'}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell text-muted-foreground">
                                    {backup.dumpSizeBytes ? formatSize(backup.dumpSizeBytes) : '-'}
                                </TableCell>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                    {backup.releaseUrl ? (
                                        <a
                                            href={backup.releaseUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary hover:underline"
                                            onClick={(e) => e.stopPropagation()}
                                            title={backup.commitSha ?? undefined}
                                        >
                                            {backup.tag ?? backup.commitSha?.slice(0, 12)}
                                        </a>
                                    ) : (
                                        (backup.commitSha?.slice(0, 12) ?? '-')
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {modal?.mode === 'live' && (
                <LogModal
                    mode="live"
                    jobId={modal.jobId}
                    domain={modal.domain}
                    siteId={modal.siteId}
                    onClose={() => {
                        setModal(null);
                        router.refresh();
                    }}
                />
            )}
            {modal?.mode === 'history' && (
                <LogModal
                    mode="history"
                    jobId={modal.backup.id}
                    domain={modal.backup.site.domain}
                    siteId={modal.backup.siteId}
                    status={modal.backup.status}
                    triggerType={modal.backup.triggerType}
                    queuedAt={new Date(modal.backup.queuedAt).toISOString()}
                    startedAt={
                        modal.backup.startedAt
                            ? new Date(modal.backup.startedAt).toISOString()
                            : undefined
                    }
                    durationMs={modal.backup.durationMs}
                    filesDownloaded={modal.backup.filesDownloaded}
                    filesUnchanged={modal.backup.filesUnchanged}
                    dumpSizeBytes={modal.backup.dumpSizeBytes}
                    commitSha={modal.backup.commitSha}
                    tag={modal.backup.tag}
                    releaseUrl={modal.backup.releaseUrl}
                    fullDownload={modal.backup.fullDownload}
                    skipGit={modal.backup.skipGit}
                    onClose={() => setModal(null)}
                />
            )}
        </>
    );
}

/** The run options, and what the run was when it was not a backup. */
function OptionsCell({
    kind,
    fullDownload,
    skipGit,
}: {
    kind: string;
    fullDownload: boolean;
    skipGit: boolean;
}) {
    const labels = [
        ...(kind === 'inventory' ? ['Inventory'] : []),
        ...optionLabels(fullDownload, skipGit),
    ];
    if (labels.length === 0) return <span className="text-muted-foreground">-</span>;
    return (
        <div className="flex gap-1">
            {labels.map((label) => (
                <Badge key={label} variant="outline" className="text-xs">
                    {label}
                </Badge>
            ))}
        </div>
    );
}
