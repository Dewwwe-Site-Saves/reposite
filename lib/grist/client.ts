/**
 * Grist REST API, the few calls the sync needs. Pure like the engine: the caller passes the decrypted configuration, nothing here reads the database or the environment.
 */

const TIMEOUT_MS = 30_000;

export interface GristConnection {
    /** Base URL of the server, without `/api`. */
    serverUrl: string;
    apiKey: string;
    docId: string;
}

/** What a cell is written with. Dates go as epoch seconds, references as the row id of the target. */
export type CellValue = string | number | boolean | null;
export type Fields = Record<string, CellValue>;

/** A row as Grist returns it: a cell can also hold a list (reference lists, choice lists) or an error object. */
export interface GristRecord {
    id: number;
    fields: Record<string, unknown>;
}

export interface RecordUpdate {
    id: number;
    fields: Fields;
}

export class GristApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'GristApiError';
    }
}

async function request<T>(
    connection: GristConnection,
    method: 'GET' | 'POST' | 'PATCH',
    route: string,
    body?: unknown,
): Promise<T> {
    const base = connection.serverUrl.replace(/\/+$/, '');
    const response = await fetch(
        `${base}/api/docs/${encodeURIComponent(connection.docId)}${route}`,
        {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${connection.apiKey}`,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            // The API never redirects. A redirect comes from whatever sits in front of the server, usually a login proxy that knows nothing of API keys: following it would end on its login page, with the key sent along.
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        },
    );
    const where = `${method} ${route.split('?')[0] || '/'}`;
    if (response.status >= 300 && response.status < 400) {
        throw new GristApiError(
            response.status,
            `${redirectTarget(response)} answered instead of Grist (redirect on ${where}): a login proxy sits in front of this URL, use an address that reaches Grist directly`,
        );
    }

    const payload = parseJson(await response.text());
    if (!response.ok) {
        const detail =
            isRecord(payload) && typeof payload.error === 'string' ? `: ${payload.error}` : '';
        throw new GristApiError(
            response.status,
            `Grist API ${response.status} on ${where}${detail}`,
        );
    }
    // Every read and every add answers with an object; only an update answers with nothing.
    if (payload === undefined || (method !== 'PATCH' && !isRecord(payload))) {
        throw new GristApiError(
            response.status,
            `Unexpected answer to ${where}: this URL does not lead to a Grist API`,
        );
    }
    return payload as T;
}

/** Undefined when the body is not JSON (an error page, or something that is not Grist); an empty body reads as null. */
function parseJson(text: string): unknown {
    if (text === '') return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return undefined;
    }
}

/** Host a redirect points to, for the error message: the login portal names itself there. */
function redirectTarget(response: Response): string {
    try {
        return new URL(response.headers.get('location') ?? '').host;
    } catch {
        return 'Something else';
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function records(table: string): string {
    return `/tables/${encodeURIComponent(table)}/records`;
}

export interface DocInfo {
    name: string;
    /** Role of the key on the document (`owners`, `editors`, `viewers`), null when the server does not say. */
    access: string | null;
}

/** The document itself: proves the server, the key and the document id in one call. */
export async function describeDoc(connection: GristConnection): Promise<DocInfo> {
    const payload = await request<{ name?: unknown; access?: unknown }>(connection, 'GET', '');
    return {
        name: typeof payload.name === 'string' ? payload.name : connection.docId,
        access: typeof payload.access === 'string' ? payload.access : null,
    };
}

/** Ids of the columns of a table. Throws GristApiError 404 when the table does not exist. */
export async function listColumnIds(
    connection: GristConnection,
    table: string,
): Promise<Set<string>> {
    const payload = await request<{ columns: { id: string }[] }>(
        connection,
        'GET',
        `/tables/${encodeURIComponent(table)}/columns`,
    );
    return new Set(payload.columns.map((column) => column.id));
}

/** Rows whose cell equals one of the listed values, for every column of the filter. */
export async function listRecords(
    connection: GristConnection,
    table: string,
    filter: Record<string, CellValue[]>,
): Promise<GristRecord[]> {
    const query = `?filter=${encodeURIComponent(JSON.stringify(filter))}`;
    const payload = await request<{ records: GristRecord[] }>(
        connection,
        'GET',
        `${records(table)}${query}`,
    );
    return payload.records;
}

/** Adds rows and returns their ids, in order. Every row must carry the same columns. */
export async function addRecords(
    connection: GristConnection,
    table: string,
    rows: Fields[],
): Promise<number[]> {
    if (rows.length === 0) return [];
    const payload = await request<{ records: { id: number }[] }>(
        connection,
        'POST',
        records(table),
        { records: rows.map((fields) => ({ fields })) },
    );
    return payload.records.map((record) => record.id);
}

/**
 * Writes the listed cells of existing rows, and only those. One request per set of columns: Grist refuses an update whose rows do not all name the same columns (400, "PATCH requires all records to have same fields").
 */
export async function updateRecords(
    connection: GristConnection,
    table: string,
    updates: RecordUpdate[],
): Promise<void> {
    const groups = new Map<string, RecordUpdate[]>();
    for (const update of updates) {
        const columns = Object.keys(update.fields).sort();
        if (columns.length === 0) continue;
        const key = columns.join('\n');
        const group = groups.get(key);
        if (group) group.push(update);
        else groups.set(key, [update]);
    }
    for (const group of groups.values()) {
        await request<unknown>(connection, 'PATCH', records(table), { records: group });
    }
}
