'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useRouter } from 'next/navigation';
import type { JobKind } from '@/lib/constants';

/**
 * One poller of `/api/status` for the whole page, shared through context: the sidebar counter, the history rows and the run buttons read the same snapshot. Server components are refreshed whenever the set of active backups changes (one queued, one claimed, one finished, queue drained), never on a plain tick.
 */

const POLL_MS = 3000;

export interface ActiveJob {
    id: number;
    siteId: number;
    domain: string;
    kind: JobKind;
    status: 'pending' | 'running';
}

export interface JobStatusContextValue {
    running: ActiveJob[];
    pending: ActiveJob[];
    /** Running first, then pending, as the API orders them. */
    active: ActiveJob[];
    /** False until the first successful poll. */
    loaded: boolean;
    /** Polls right away, after an action that changes the queue. */
    refresh: () => Promise<void>;
}

const JobStatusContext = createContext<JobStatusContextValue | null>(null);

export function JobStatusProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter();
    const [snapshot, setSnapshot] = useState<{ running: ActiveJob[]; pending: ActiveJob[] }>({
        running: [],
        pending: [],
    });
    const [loaded, setLoaded] = useState(false);
    const lastKey = useRef<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch('/api/status', { cache: 'no-store' });
            if (res.status === 401) {
                // Session expired: the next navigation would bounce anyway, do it now.
                router.push('/login');
                return;
            }
            if (!res.ok) return;
            const data = (await res.json()) as { running: ActiveJob[]; pending: ActiveJob[] };
            // Same queue as last tick: keep the previous object so consumers do not re-render.
            setSnapshot((prev) =>
                snapshotKey(prev) === snapshotKey(data)
                    ? prev
                    : { running: data.running, pending: data.pending },
            );
            setLoaded(true);
        } catch {
            // Transient network error: the next tick retries.
        }
    }, [router]);

    useEffect(() => {
        void refresh();
        const interval = setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, POLL_MS);
        return () => clearInterval(interval);
    }, [refresh]);

    // Refresh the server-rendered data when the queue changes shape, not on every tick.
    const key = snapshotKey(snapshot);
    useEffect(() => {
        if (!loaded) return;
        if (lastKey.current !== null && lastKey.current !== key) router.refresh();
        lastKey.current = key;
    }, [key, loaded, router]);

    const value = useMemo<JobStatusContextValue>(
        () => ({
            running: snapshot.running,
            pending: snapshot.pending,
            active: [...snapshot.running, ...snapshot.pending],
            loaded,
            refresh,
        }),
        [snapshot, loaded, refresh],
    );

    return <JobStatusContext.Provider value={value}>{children}</JobStatusContext.Provider>;
}

/** Ids and statuses of the active backups, running first: equal keys mean nothing changed. */
function snapshotKey(snapshot: { running: ActiveJob[]; pending: ActiveJob[] }): string {
    return [...snapshot.running, ...snapshot.pending].map((b) => `${b.id}:${b.status}`).join(',');
}

export function useJobStatus(): JobStatusContextValue {
    const context = useContext(JobStatusContext);
    if (!context) throw new Error('useJobStatus must be used inside JobStatusProvider');
    return context;
}
