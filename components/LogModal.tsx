'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useJobStatus } from '@/components/JobStatusProvider';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { parseLog } from '@/lib/engine/logger';
import type { LogEntry } from '@/lib/engine/types';
import { formatDuration, formatSize, optionLabels } from '@/lib/format';

/** Fields shown in the run info header, all optional until the backup finishes. */
interface RunStats {
    durationMs?: number | null;
    filesDownloaded?: number | null;
    filesUnchanged?: number | null;
    dumpSizeBytes?: number | null;
    commitSha?: string | null;
    tag?: string | null;
    releaseUrl?: string | null;
    errorMessage?: string | null;
}

/** What the SSE `status` events know about the row, merged as they arrive. */
interface RunInfoFields {
    queuedAt?: string | null;
    startedAt?: string | null;
    triggerType?: string;
    fullDownload?: boolean;
    skipGit?: boolean;
}

const FINAL_STATUSES = new Set(['success', 'error', 'cancelled']);

// --- Run mode: show options, start backup, stream logs ---
interface RunModeProps {
    mode: 'run';
    siteId: number;
    domain: string;
    onClose: () => void;
}

// --- Live mode: stream logs for a pending or running backup ---
interface LiveModeProps {
    mode: 'live';
    jobId: number;
    domain: string;
    siteId?: number;
    onClose: () => void;
}

// --- History mode: show stored log from DB ---
interface HistoryModeProps extends RunStats, RunInfoFields {
    mode: 'history';
    jobId: number;
    domain: string;
    siteId?: number;
    status?: string;
    onClose: () => void;
}

type LogModalProps = RunModeProps | LiveModeProps | HistoryModeProps;

export function LogModal(props: LogModalProps) {
    const { onClose } = props;
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/50" />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`Backup of ${props.domain}`}
                className="relative w-full max-w-3xl max-h-[90vh] sm:max-h-[80vh] flex flex-col rounded-lg border bg-card shadow-lg overflow-hidden text-left"
                onClick={(e) => e.stopPropagation()}
            >
                {props.mode === 'run' && <RunContent {...props} />}
                {props.mode === 'live' && <LiveContent {...props} />}
                {props.mode === 'history' && <HistoryContent {...props} />}
            </div>
        </div>
    );
}

/** Final stats of a backup from the detail route, once it is over. */
async function fetchStats(jobId: number): Promise<RunStats> {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) throw new Error('Backup not found');
    const data = await res.json();
    return {
        durationMs: data.durationMs,
        filesDownloaded: data.filesDownloaded,
        filesUnchanged: data.filesUnchanged,
        dumpSizeBytes: data.dumpSizeBytes,
        commitSha: data.commitSha,
        tag: data.tag,
        releaseUrl: data.releaseUrl,
        errorMessage: data.errorMessage,
    };
}

async function cancelJob(jobId: number): Promise<void> {
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
}

// ============ Run Mode ============

function RunContent({ siteId, domain, onClose }: RunModeProps) {
    const { refresh } = useJobStatus();
    const [fullDownload, setFullDownload] = useState(false);
    const [skipGit, setSkipGit] = useState(false);
    const [jobId, setJobId] = useState<number | null>(null);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [startedAt, setStartedAt] = useState<string | null>(null);
    const [runStatus, setRunStatus] = useState<string | null>(null);
    const [stats, setStats] = useState<RunStats>({});
    const [logOpen, setLogOpen] = useState(true);

    async function handleStart() {
        setStarting(true);
        setError(null);
        try {
            const res = await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ siteIds: [siteId], fullDownload, skipGit }),
            });
            const data = await res.json();
            const queued = data.queued?.[0];
            if (res.ok && queued) {
                setJobId(queued.jobId);
                setRunStatus('pending');
                void refresh();
            } else {
                setError(data.error || 'Could not queue the backup');
                setStarting(false);
            }
        } catch {
            setError('Could not queue the backup');
            setStarting(false);
        }
    }

    function handleStatusChange(status: string, info: RunInfoFields) {
        setRunStatus(status);
        if (info.startedAt) setStartedAt(info.startedAt);
        if (FINAL_STATUSES.has(status) && jobId) {
            fetchStats(jobId)
                .then(setStats)
                .catch(() => {});
        }
    }

    return (
        <>
            <ModalHeader
                domain={domain}
                siteId={siteId}
                status={runStatus}
                onClose={onClose}
                onCancel={jobId ? () => cancelJob(jobId) : undefined}
            />
            <div className="flex-1 overflow-y-auto">
                {!jobId ? (
                    <div className="p-4 space-y-4">
                        {error && (
                            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                                {error}
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>Full download</Label>
                                <p className="text-xs text-muted-foreground">
                                    Re-download all files instead of incremental
                                </p>
                            </div>
                            <Switch checked={fullDownload} onCheckedChange={setFullDownload} />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <Label>Skip git commit</Label>
                                <p className="text-xs text-muted-foreground">
                                    Download files without committing to GitHub
                                </p>
                            </div>
                            <Switch checked={skipGit} onCheckedChange={setSkipGit} />
                        </div>
                        <Button onClick={handleStart} disabled={starting} className="w-full">
                            {starting ? 'Starting...' : 'Start Backup'}
                        </Button>
                    </div>
                ) : (
                    <>
                        <RunInfo
                            startedAt={startedAt}
                            triggerType="manual"
                            fullDownload={fullDownload}
                            skipGit={skipGit}
                            {...stats}
                        />
                        <CollapsibleLog open={logOpen} onToggle={() => setLogOpen(!logOpen)}>
                            <LogStream jobId={jobId} onStatusChange={handleStatusChange} />
                        </CollapsibleLog>
                    </>
                )}
            </div>
        </>
    );
}

// ============ Live Mode ============

function LiveContent({ jobId, domain, siteId, onClose }: LiveModeProps) {
    const [runStatus, setRunStatus] = useState<string | null>(null);
    const [info, setInfo] = useState<RunInfoFields & RunStats>({});
    const [logOpen, setLogOpen] = useState(true);
    // A backup already over sends its final status twice (initial `status`, then `done`): one fetch is enough.
    const statsFetched = useRef(false);

    function handleStatusChange(status: string, fields: RunInfoFields) {
        setRunStatus(status);
        setInfo((prev) => ({ ...prev, ...fields }));
        if (FINAL_STATUSES.has(status) && !statsFetched.current) {
            statsFetched.current = true;
            fetchStats(jobId)
                .then((stats) => setInfo((prev) => ({ ...prev, ...stats })))
                .catch(() => {});
        }
    }

    return (
        <>
            <ModalHeader
                domain={domain}
                siteId={siteId}
                status={runStatus}
                onClose={onClose}
                onCancel={() => cancelJob(jobId)}
            />
            <div className="flex-1 overflow-y-auto">
                <RunInfo {...info} />
                <CollapsibleLog open={logOpen} onToggle={() => setLogOpen(!logOpen)}>
                    <LogStream jobId={jobId} onStatusChange={handleStatusChange} />
                </CollapsibleLog>
            </div>
        </>
    );
}

// ============ History Mode ============

function HistoryContent({
    jobId,
    domain,
    siteId,
    status: initialStatus,
    onClose,
    ...initialInfo
}: HistoryModeProps) {
    const [logLines, setLogLines] = useState<LogEntry[] | null>(null);
    const [status, setStatus] = useState<string | null>(initialStatus ?? null);
    const [logOpen, setLogOpen] = useState(false);
    const [info, setInfo] = useState<RunStats & RunInfoFields>(initialInfo);

    useEffect(() => {
        fetch(`/api/jobs/${jobId}`)
            .then((res) => {
                if (!res.ok) throw new Error('Backup not found');
                return res.json();
            })
            .then((data) => {
                setLogLines(parseLog(data.log || ''));
                setStatus(data.status);
                setInfo({
                    triggerType: data.triggerType,
                    queuedAt: data.queuedAt,
                    startedAt: data.startedAt,
                    durationMs: data.durationMs,
                    filesDownloaded: data.filesDownloaded,
                    filesUnchanged: data.filesUnchanged,
                    dumpSizeBytes: data.dumpSizeBytes,
                    commitSha: data.commitSha,
                    tag: data.tag,
                    releaseUrl: data.releaseUrl,
                    errorMessage: data.errorMessage,
                    fullDownload: data.fullDownload,
                    skipGit: data.skipGit,
                });
            })
            .catch(() => {
                setLogLines([{ time: '', level: 'error', msg: 'Failed to load the log' }]);
            });
    }, [jobId]);

    return (
        <>
            <ModalHeader domain={domain} siteId={siteId} status={status} onClose={onClose} />
            <div className="flex-1 overflow-y-auto">
                <RunInfo {...info} />
                <CollapsibleLog open={logOpen} onToggle={() => setLogOpen(!logOpen)}>
                    <div className="p-4 font-mono text-xs bg-slate-950 text-slate-300 h-[300px] overflow-y-auto">
                        {logLines === null ? (
                            <span className="text-slate-500">Loading...</span>
                        ) : logLines.length === 0 ? (
                            <span className="text-slate-500">No log stored for this run</span>
                        ) : (
                            logLines.map((line, i) => <LogLine key={i} line={line} />)
                        )}
                    </div>
                </CollapsibleLog>
            </div>
        </>
    );
}

// ============ Shared Components ============

function ModalHeader({
    domain,
    siteId,
    status,
    onClose,
    onCancel,
}: {
    domain: string;
    siteId?: number;
    status: string | null;
    onClose: () => void;
    onCancel?: () => void;
}) {
    const active = status === 'pending' || status === 'running';

    return (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-3">
                {siteId ? (
                    <Link
                        href={`/sites/${siteId}`}
                        className="font-medium text-primary hover:underline"
                    >
                        {domain}
                    </Link>
                ) : (
                    <span className="font-medium">{domain}</span>
                )}
                {status && <StatusBadge status={status} />}
            </div>
            <div className="flex items-center gap-2">
                {onCancel && active && (
                    <Button variant="destructive" size="sm" onClick={onCancel}>
                        Cancel run
                    </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    );
}

function RunInfo({
    queuedAt,
    startedAt,
    triggerType,
    durationMs,
    filesDownloaded,
    filesUnchanged,
    dumpSizeBytes,
    commitSha,
    tag,
    releaseUrl,
    errorMessage,
    fullDownload,
    skipGit,
}: RunStats & RunInfoFields) {
    const options = optionLabels(!!fullDownload, !!skipGit, true);
    const queued = !startedAt && queuedAt ? queuedAt : null;

    return (
        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm border-b border-border">
            {errorMessage && (
                <div className="col-span-2 sm:col-span-3">
                    <span className="text-muted-foreground text-xs">Error</span>
                    <p className="font-medium text-xs text-destructive break-words">
                        {errorMessage}
                    </p>
                </div>
            )}
            {startedAt && (
                <div>
                    <span className="text-muted-foreground text-xs">Started</span>
                    <p className="font-medium text-xs">{new Date(startedAt).toLocaleString()}</p>
                </div>
            )}
            {queued && (
                <div>
                    <span className="text-muted-foreground text-xs">Queued</span>
                    <p className="font-medium text-xs">{new Date(queued).toLocaleString()}</p>
                </div>
            )}
            {triggerType && (
                <div>
                    <span className="text-muted-foreground text-xs">Trigger</span>
                    <p className="font-medium text-xs capitalize">{triggerType}</p>
                </div>
            )}
            {durationMs != null && (
                <div>
                    <span className="text-muted-foreground text-xs">Duration</span>
                    <p className="font-medium text-xs">{formatDuration(durationMs)}</p>
                </div>
            )}
            {filesDownloaded != null && (
                <div>
                    <span className="text-muted-foreground text-xs">Files (updated / total)</span>
                    <p className="font-medium text-xs">
                        {filesDownloaded} / {filesDownloaded + (filesUnchanged ?? 0)}
                    </p>
                </div>
            )}
            <div>
                <span className="text-muted-foreground text-xs">Options</span>
                <p className="font-medium text-xs">
                    {options.length > 0 ? options.join(', ') : 'Default'}
                </p>
            </div>
            {dumpSizeBytes != null && (
                <div>
                    <span className="text-muted-foreground text-xs">DB dump</span>
                    <p className="font-medium text-xs">{formatSize(dumpSizeBytes)}</p>
                </div>
            )}
            {commitSha && (
                <div>
                    <span className="text-muted-foreground text-xs">Commit</span>
                    <p className="font-medium text-xs font-mono">
                        {commitSha.slice(0, 12)}
                        {releaseUrl && (
                            <>
                                {' '}
                                <a
                                    href={releaseUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-sans text-primary hover:underline"
                                >
                                    Release {tag ?? ''} ↗
                                </a>
                            </>
                        )}
                    </p>
                </div>
            )}
        </div>
    );
}

function CollapsibleLog({
    open,
    onToggle,
    children,
}: {
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="border-t border-border">
            <button
                type="button"
                onClick={onToggle}
                className="w-full px-4 py-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors cursor-pointer"
            >
                <svg
                    className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {open ? 'Hide log' : 'Show log'}
            </button>
            {open && <div className="h-[300px]">{children}</div>}
        </div>
    );
}

function LogLine({ line }: { line: LogEntry }) {
    const color =
        line.level === 'error'
            ? 'text-red-400'
            : line.level === 'warn'
              ? 'text-yellow-400'
              : 'text-slate-300';
    return (
        <div className={`py-0.5 ${color}`}>
            {line.time && (
                <span className="text-slate-600 mr-2">
                    {new Date(line.time).toLocaleTimeString()}
                </span>
            )}
            {line.msg}
        </div>
    );
}

function LogStream({
    jobId,
    onStatusChange,
}: {
    jobId: number;
    onStatusChange?: (status: string, info: RunInfoFields) => void;
}) {
    const [lines, setLines] = useState<LogEntry[]>([]);
    const [connected, setConnected] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    // Latest callback without re-subscribing the event source on every parent render
    const onStatusChangeRef = useRef(onStatusChange);
    useEffect(() => {
        onStatusChangeRef.current = onStatusChange;
    });

    useEffect(() => {
        setLines([]);
        setConnected(false);
        const source = new EventSource(`/api/jobs/${jobId}/stream`);

        // The browser reconnects after a dropped connection and the server replays the buffered lines: start from a clean slate each time.
        source.onopen = () => {
            setLines([]);
            setConnected(true);
        };

        source.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setConnected(true);
            if (data.type === 'log') {
                setLines((prev) => [
                    ...prev,
                    { time: data.time, level: data.level, msg: data.msg },
                ]);
            } else if (data.type === 'status') {
                const { type: _type, status, domain: _domain, ...info } = data;
                onStatusChangeRef.current?.(status, info);
            } else if (data.type === 'done') {
                // The final status is stored before `done` is sent: no client-side guess.
                onStatusChangeRef.current?.(data.status, {});
                source.close();
            }
        };

        // Left open on error: EventSource retries by itself. `done` is the only close.
        return () => source.close();
    }, [jobId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [lines]);

    return (
        <div className="p-4 font-mono text-xs bg-slate-950 text-slate-300 text-left h-full overflow-y-auto">
            {lines.length === 0 && (
                <span className="text-slate-500">
                    {connected ? 'Waiting for the worker...' : 'Connecting...'}
                </span>
            )}
            {lines.map((line, i) => (
                <LogLine key={i} line={line} />
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
