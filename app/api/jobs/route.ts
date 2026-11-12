import { NextResponse } from 'next/server';
import { apiHandler, jsonError, parseBody, validationError } from '@/lib/api';
import { getSite, listJobs, listSites, type SiteSummary } from '@/lib/db';
import { JobConflictError, enqueue } from '@/lib/jobs/queue';
import { requireRole } from '@/lib/session';
import { jobsQuerySchema, runBackupSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Paginated history: `?siteId=&status=&page=&pageSize=`. Rows carry no log, see `GET /api/jobs/[id]`. */
export const GET = apiHandler(async (request: Request) => {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = jobsQuerySchema.safeParse(query);
    if (!parsed.success) return validationError(parsed.error);
    return NextResponse.json(await listJobs(parsed.data));
});

/** Queues one backup per site: the given `siteIds`, or every enabled site. Sites with an active backup are reported in `conflicts`; 409 when nothing could be queued. */
export const POST = apiHandler(async (request: Request) => {
    await requireRole('admin');
    const { data, response } = await parseBody(request, runBackupSchema);
    if (response) return response;

    let sites: SiteSummary[];
    if (data.siteIds) {
        sites = [];
        for (const siteId of data.siteIds) {
            const site = await getSite(siteId);
            if (!site) return jsonError(404, `Site not found: ${siteId}`);
            sites.push(site);
        }
    } else {
        sites = (await listSites()).filter((site) => site.enabled);
        if (sites.length === 0) return jsonError(400, 'No enabled sites');
    }

    const queued: { jobId: number; siteId: number; domain: string }[] = [];
    const conflicts: { siteId: number; domain: string }[] = [];
    for (const site of sites) {
        try {
            const jobId = await enqueue(site.id, {
                fullDownload: data.fullDownload,
                skipGit: data.skipGit,
            });
            queued.push({ jobId, siteId: site.id, domain: site.domain });
        } catch (error) {
            if (!(error instanceof JobConflictError)) throw error;
            conflicts.push({ siteId: site.id, domain: site.domain });
        }
    }

    if (queued.length === 0) {
        return jsonError(409, 'A backup is already pending or running', { queued, conflicts });
    }
    return NextResponse.json({ queued, conflicts }, { status: 201 });
});
