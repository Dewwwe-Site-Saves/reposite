import { NextResponse } from 'next/server';
import { apiHandler, jsonError, parseBody } from '@/lib/api';
import { getSettings, toSettingsView, updateSettings } from '@/lib/db';
import * as scheduler from '@/lib/jobs/scheduler';
import { requireRole } from '@/lib/session';
import { settingsSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
    return NextResponse.json(toSettingsView(await getSettings()));
});

/** Masked or empty secrets keep their stored value. */
export const PUT = apiHandler(async (request: Request) => {
    await requireRole('admin');
    const { data, response } = await parseBody(request, settingsSchema);
    if (response) return response;

    // A stored key is only ever sent to the server it was saved for: pointing Grist elsewhere takes the key again.
    const current = await getSettings();
    if (
        current.gristApiKeyEnc &&
        !data.gristApiKey &&
        data.gristUrl !== null &&
        data.gristUrl !== current.gristUrl
    ) {
        return jsonError(400, 'Type the Grist API key again to change the server');
    }

    const settings = await updateSettings(data);
    // The default schedule may have changed.
    await scheduler.reload();
    return NextResponse.json(toSettingsView(settings));
});
