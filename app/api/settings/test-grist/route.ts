import { NextResponse } from 'next/server';
import { apiHandler, jsonError, parseBody } from '@/lib/api';
import { getGristApiKey, getSettings, listSites, toGristConfig } from '@/lib/db';
import { checkGrist } from '@/lib/grist/check';
import { requireRole } from '@/lib/session';
import { gristTestSchema } from '@/lib/validation';

/** Checks the Grist block being typed, read-only: the document, the columns of the two tables, and which sites already have a row. The stored key is used only against the stored server: a key must never be sent to a URL it was not saved for. */
export const POST = apiHandler(async (request: Request) => {
    await requireRole('admin');
    const { data, response } = await parseBody(request, gristTestSchema);
    if (response) return response;

    const settings = await getSettings();
    let apiKey = data.gristApiKey ?? null;
    if (!apiKey) {
        if (settings.gristApiKeyEnc && data.gristUrl !== settings.gristUrl) {
            return jsonError(400, 'Type the API key again to test another server');
        }
        apiKey = await getGristApiKey(settings);
    }
    const config = toGristConfig(data, apiKey);
    if (!config) {
        return jsonError(400, 'Server URL, API key, document and sites table are required');
    }

    const sites = await listSites();
    return NextResponse.json(
        await checkGrist(
            config,
            sites.map((site) => site.domain),
        ),
    );
});
