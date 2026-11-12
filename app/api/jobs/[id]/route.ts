import { NextResponse } from 'next/server';
import { apiHandler, jsonError } from '@/lib/api';
import { getJob } from '@/lib/db';
import { parseId } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Full detail of one backup, log included. */
export const GET = apiHandler(
    async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
        const id = parseId((await params).id);
        const job = id ? await getJob(id) : null;
        if (!job) return jsonError(404, 'Backup not found');

        const { site, log, ...row } = job;
        return NextResponse.json({ ...row, domain: site.domain, log: log ?? '' });
    },
);
