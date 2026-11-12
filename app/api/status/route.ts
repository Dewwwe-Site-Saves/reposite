import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api';
import { listActiveJobs } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Polled by the UI: what is executing and what waits in the queue. */
export const GET = apiHandler(async () => {
    const active = await listActiveJobs();
    return NextResponse.json({
        running: active.filter((b) => b.status === 'running'),
        pending: active.filter((b) => b.status === 'pending'),
    });
});
