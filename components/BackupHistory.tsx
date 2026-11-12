'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlayIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useJobStatus } from '@/components/JobStatusProvider';
import { LogModal } from '@/components/LogModal';
import { RowMenu, type RowMenuItem } from '@/components/RowMenu';
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
import type { JobKind, JobView } from '@/lib/constants';
import type { JobWithDomain } from '@/lib/db';
import { formatDuration, formatRelative, formatSize, optionLabels } from '@/lib/format';

const isActive = (status: string) => status === 'pending' || status === 'running';

type ModalState =
    | { mode: 'run'; siteId: number; domain: string }
    | { mode: 'live'; jobId: number; domain: string; siteId: number }
    | { mode: 'history'; backup: JobWithDomain };

/**
 * The runs of the history, two lines per row: what and where on the first, the detail under it. Nothing has a column of its own that can sit under something else: the tag and its Release link go under the site, the exact time under the relative one, the duration next to the status, the trigger and the options together, the dump size under the file count.
 */
export function BackupHistory({
    backups,
    showDomain = true,
    kindFilter = 'backup',
    siteId,
    viewFilter,
}: {
    backups: JobWithDomain[];
    /** Off on a site's own page: the first column then only carries the snapshot. */
    showDomain?: boolean;
    /** Only active jobs of this kind are added as extra rows, backups unless the list shows something else. */
    kindFilter?: JobKind | 'all';
    /** Only this site's active jobs are added as extra rows. */
    siteId?: number;
    /** The tab the list is showing: active jobs are not added as extra rows to the list of issues. */
    viewFilter?: JobView;
}) {
    const { active } = useJobStatus();
    const [modal, setModal] = useState<ModalState | null>(null);
    const router = useRouter();

    // The row is the job: a pending or running row is followed live under its own id.
    function openLog(backup: JobWithDomain) {
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

    // Active jobs queued since this page was rendered, shown until the next server refresh brings their rows.
    const knownIds = new Set(backups.map((b) => b.id));
    const extraRows = active.filter(
        (j) =>
            !knownIds.has(j.id) &&
            viewFilter !== 'issues' &&
            (kindFilter === 'all' || j.kind === kindFilter) &&
            (siteId === undefined || j.siteId === siteId),
    );

    function siteItems(targetSiteId: number): RowMenuItem[] {
        return showDomain
            ? [{ label: 'Open site', onSelect: () => router.push(`/sites/${targetSiteId}`) }]
            : [];
    }

    return (
        <>
            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{showDomain ? 'Site' : 'Snapshot'}</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden lg:table-cell">Run</TableHead>
                            <TableHead className="hidden sm:table-cell">Files</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {extraRows.map((job) => {
                            const follow = () =>
                                setModal({
                                    mode: 'live',
                                    jobId: job.id,
                                    domain: job.domain,
                                    siteId: job.siteId,
                                });
                            return (
                                <TableRow
                                    key={`active-${job.id}`}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={follow}
                                >
                                    <TableCell>
                                        {showDomain && <p className="font-medium">{job.domain}</p>}
                                        <p className="font-mono text-xs text-muted-foreground">-</p>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">Now</TableCell>
                                    <TableCell>
                                        <StatusBadge status={job.status} />
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        <RunCell kind={job.kind} />
                                    </TableCell>
                                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                                        -
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <RowMenu
                                            label={`More about the ${job.kind} of ${job.domain}`}
                                            items={[
                                                { label: 'View log', onSelect: follow },
                                                ...siteItems(job.siteId),
                                            ]}
                                        />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {backups.map((backup) => {
                            const date = new Date(backup.startedAt ?? backup.queuedAt);
                            const releaseUrl = backup.releaseUrl;
                            return (
                                <TableRow
                                    key={backup.id}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => openLog(backup)}
                                >
                                    <TableCell>
                                        {showDomain && (
                                            <p className="font-medium">{backup.site.domain}</p>
                                        )}
                                        <p className="font-mono text-xs text-muted-foreground">
                                            <Snapshot backup={backup} />
                                        </p>
                                    </TableCell>
                                    <TableCell>
                                        <p suppressHydrationWarning>
                                            {formatRelative(date, new Date())}
                                        </p>
                                        <p
                                            className="text-xs text-muted-foreground"
                                            suppressHydrationWarning
                                        >
                                            {date.toLocaleString()}
                                        </p>
                                    </TableCell>
                                    <TableCell>
                                        <span className="flex items-center gap-2">
                                            <StatusBadge status={backup.status} />
                                            {backup.durationMs != null && (
                                                <span className="text-xs text-muted-foreground">
                                                    {formatDuration(backup.durationMs)}
                                                </span>
                                            )}
                                        </span>
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell">
                                        <RunCell
                                            kind={backup.kind}
                                            triggerType={backup.triggerType}
                                            fullDownload={backup.fullDownload}
                                            skipGit={backup.skipGit}
                                        />
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell">
                                        {backup.filesDownloaded != null ? (
                                            <>
                                                <p>
                                                    {backup.filesDownloaded} /{' '}
                                                    {backup.filesDownloaded +
                                                        (backup.filesUnchanged ?? 0)}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {backup.dumpSizeBytes
                                                        ? `dump ${formatSize(backup.dumpSizeBytes)}`
                                                        : 'no dump'}
                                                </p>
                                            </>
                                        ) : (
                                            <span className="text-muted-foreground">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <span className="inline-flex items-center gap-1">
                                            <button
                                                type="button"
                                                aria-label={`Run a backup of ${backup.site.domain}`}
                                                title="Run a backup"
                                                className="rounded-md p-1.5 text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setModal({
                                                        mode: 'run',
                                                        siteId: backup.siteId,
                                                        domain: backup.site.domain,
                                                    });
                                                }}
                                            >
                                                <HugeiconsIcon icon={PlayIcon} size={16} />
                                            </button>
                                            <RowMenu
                                                label={`More about this run of ${backup.site.domain}`}
                                                items={[
                                                    {
                                                        label: 'View log',
                                                        onSelect: () => openLog(backup),
                                                    },
                                                    ...(releaseUrl
                                                        ? [
                                                              {
                                                                  label: 'Open release',
                                                                  onSelect: () =>
                                                                      window.open(
                                                                          releaseUrl,
                                                                          '_blank',
                                                                          'noopener,noreferrer',
                                                                      ),
                                                              },
                                                          ]
                                                        : []),
                                                    ...siteItems(backup.siteId),
                                                ]}
                                            />
                                        </span>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            {modal?.mode === 'run' && (
                <LogModal
                    mode="run"
                    siteId={modal.siteId}
                    domain={modal.domain}
                    onClose={() => {
                        setModal(null);
                        router.refresh();
                    }}
                />
            )}
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

/** The snapshot a run produced: its tag, linked to the Release when there is one, else the commit, else nothing. */
function Snapshot({ backup }: { backup: JobWithDomain }) {
    const label = backup.tag ?? backup.commitSha?.slice(0, 12);
    if (!label) return <>-</>;
    if (!backup.releaseUrl) return <>{label}</>;
    return (
        <a
            href={backup.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
            title={backup.commitSha ?? undefined}
        >
            {label}
        </a>
    );
}

/** How the run was started, and under it what kind of run it was when not a plain backup. */
function RunCell({
    kind,
    triggerType,
    fullDownload = false,
    skipGit = false,
}: {
    kind: string;
    triggerType?: string;
    fullDownload?: boolean;
    skipGit?: boolean;
}) {
    const labels = [
        ...(kind === 'inventory' ? ['Inventory'] : []),
        ...optionLabels(fullDownload, skipGit),
    ];
    return (
        <>
            <p className="capitalize">{triggerType ?? '-'}</p>
            {labels.length > 0 && (
                <div className="mt-0.5 flex gap-1">
                    {labels.map((label) => (
                        <Badge key={label} variant="outline" className="text-xs">
                            {label}
                        </Badge>
                    ))}
                </div>
            )}
        </>
    );
}
