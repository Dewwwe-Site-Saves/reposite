import { vi } from 'vitest';

export interface FakeRow {
    id: number;
    fields: Record<string, unknown>;
}

export interface FakeCall {
    method: string;
    /** Empty for a call on the document itself. */
    table: string;
    body: { records: { id?: number; fields: Record<string, unknown> }[] } | null;
}

/**
 * In-memory Grist document behind `fetch`, for the tests: the document itself, the columns of a table, filtered reads, adds and updates. An update request behaves like the real server (checked on the `gristlabs/grist:stable` image in November 2026): it is refused when its rows do not all name the same columns.
 */
export class FakeGrist {
    readonly tables = new Map<string, { columns: string[]; rows: FakeRow[] }>();
    readonly calls: FakeCall[] = [];
    /** What the document says of the key that reads it. */
    access = 'editors';
    private nextId = 1;

    constructor(
        private readonly docId = 'doc1',
        private readonly apiKey = 'secret-key',
    ) {}

    table(name: string, columns: string[], rows: Record<string, unknown>[] = []): this {
        this.tables.set(name, {
            columns,
            rows: rows.map((fields) => ({ id: this.nextId++, fields: { ...fields } })),
        });
        return this;
    }

    rows(name: string): FakeRow[] {
        return this.tables.get(name)!.rows;
    }

    writes(): FakeCall[] {
        return this.calls.filter((call) => call.method !== 'GET');
    }

    /** Replaces the global `fetch`; the test restores it with `vi.unstubAllGlobals()`. */
    install(): this {
        vi.stubGlobal('fetch', async (input: string, init: RequestInit) =>
            this.handle(input, init),
        );
        return this;
    }

    private handle(input: string, init: RequestInit): Response {
        const url = new URL(input);
        if ((init.headers as Record<string, string>).Authorization !== `Bearer ${this.apiKey}`) {
            return json(401, { error: 'invalid API key' });
        }
        const root = `/api/docs/${this.docId}`;
        const method = init.method ?? 'GET';
        if (url.pathname === root) {
            this.calls.push({ method, table: '', body: null });
            return json(200, { id: this.docId, name: 'Fake document', access: this.access });
        }
        const match = url.pathname.startsWith(`${root}/`)
            ? /^tables\/([^/]+)\/(columns|records)$/.exec(url.pathname.slice(root.length + 1))
            : null;
        const table = match && this.tables.get(match[1]!);
        if (!match || !table) return json(404, { error: 'Table not found' });

        const body = init.body ? (JSON.parse(init.body as string) as FakeCall['body']) : null;
        this.calls.push({ method, table: match[1]!, body });

        if (match[2] === 'columns') {
            return json(200, { columns: table.columns.map((id) => ({ id, fields: {} })) });
        }
        if (method === 'GET') {
            const filter = JSON.parse(url.searchParams.get('filter') ?? '{}') as Record<
                string,
                unknown[]
            >;
            const records = table.rows.filter((row) =>
                Object.entries(filter).every(([column, values]) =>
                    values.includes(row.fields[column] ?? null),
                ),
            );
            return json(200, { records });
        }
        if (method === 'POST') {
            const added = body!.records.map(({ fields }) => {
                const row = { id: this.nextId++, fields: { ...fields } };
                table.rows.push(row);
                return { id: row.id };
            });
            return json(200, { records: added });
        }
        const columns = (record: { fields: Record<string, unknown> }): string =>
            Object.keys(record.fields).sort().join('\n');
        if (new Set(body!.records.map(columns)).size > 1) {
            return json(400, { error: 'PATCH requires all records to have same fields' });
        }
        for (const record of body!.records) {
            const row = table.rows.find((candidate) => candidate.id === record.id)!;
            Object.assign(row.fields, record.fields);
        }
        return json(200, null);
    }
}

function json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
