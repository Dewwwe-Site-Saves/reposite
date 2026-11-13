import { NextResponse } from 'next/server';
import { apiHandler, jsonError } from '@/lib/api';
import { getGristConfig } from '@/lib/db';
import { pushAll } from '@/lib/grist/push';
import { requireRole } from '@/lib/session';

/** Pushes every site to Grist now, with the stored configuration, and answers once they are all done: the first fill of a document, or a catch-up after an outage. */
export const POST = apiHandler(async () => {
    await requireRole('admin');
    if (!(await getGristConfig())) return jsonError(400, 'Grist is not configured');

    const results = await pushAll();
    return NextResponse.json({
        ok: results.every((result) => result.error === null),
        results: results.map(({ siteId, domain, error, report }) => ({
            siteId,
            domain,
            error,
            created: report?.siteCreated ?? false,
            components: report?.components ?? null,
        })),
    });
});
