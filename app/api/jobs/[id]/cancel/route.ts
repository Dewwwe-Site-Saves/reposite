import { NextResponse } from 'next/server';
import { apiHandler, jsonError } from '@/lib/api';
import { getJob } from '@/lib/db';
import { cancel } from '@/lib/jobs/queue';
import { requireRole } from '@/lib/session';
import { parseId } from '@/lib/validation';

export const POST = apiHandler(
    async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
        await requireRole('admin');
        const id = parseId((await params).id);
        if (!id) return jsonError(404, 'Backup not found');

        // The queue is asked first: a run whose site was deleted has no row any more but is still cancellable.
        if (await cancel(id)) {
            return NextResponse.json({ success: true, jobId: id });
        }
        const job = await getJob(id);
        if (!job) return jsonError(404, 'Backup not found');
        return jsonError(400, 'Backup cannot be cancelled (already finished)');
    },
);
