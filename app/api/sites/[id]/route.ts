import { NextResponse } from 'next/server';
import { apiHandler, jsonError, parseBody } from '@/lib/api';
import { deleteSite, getSite, isUniqueViolation, listJobs, updateSite } from '@/lib/db';
import * as scheduler from '@/lib/jobs/scheduler';
import { requireRole } from '@/lib/session';
import { jobsQuerySchema, parseId, siteUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = apiHandler(async (request: Request, { params }: Params) => {
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) return jsonError(404, 'Site not found');

    const backups = await listJobs(jobsQuerySchema.parse({ siteId: site.id, pageSize: 20 }));
    return NextResponse.json({ site, backups: backups.items });
});

export const PUT = apiHandler(async (request: Request, { params }: Params) => {
    await requireRole('admin');
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) return jsonError(404, 'Site not found');

    const { data, response } = await parseBody(request, siteUpdateSchema);
    if (response) return response;

    try {
        const updated = await updateSite(site.id, data);
        await scheduler.reload();
        return NextResponse.json(updated);
    } catch (error) {
        if (isUniqueViolation(error)) {
            return jsonError(409, 'A site with this domain or repository name already exists');
        }
        throw error;
    }
});

export const DELETE = apiHandler(async (request: Request, { params }: Params) => {
    await requireRole('admin');
    const id = parseId((await params).id);
    const site = id ? await getSite(id) : null;
    if (!site) return jsonError(404, 'Site not found');

    await deleteSite(site.id);
    await scheduler.reload();
    return NextResponse.json({ success: true });
});
