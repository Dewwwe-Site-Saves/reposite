import { apiHandler, jsonError } from '@/lib/api';
import { getJob } from '@/lib/db';
import { parseLog } from '@/lib/engine/logger';
import { subscribe } from '@/lib/jobs/queue';
import { isActive, parseId } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

/**
 * SSE stream for one backup: `status` (current, then `running` when the worker claims the row), `log` lines (replay, then live), `done` with the final status. A finished backup gets its stored log replayed and `done` right away.
 */
export const GET = apiHandler(
    async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
        const id = parseId((await params).id);
        const job = id ? await getJob(id) : null;
        if (!job) return jsonError(404, 'Backup not found');

        const jobId = job.id;
        const domain = job.site.domain;
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                let closed = false;
                const send = (payload: Record<string, unknown>) => {
                    if (!closed)
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                };
                // A comment line every 25 s keeps an idle reverse proxy from dropping the connection between two log lines.
                const heartbeat = setInterval(() => {
                    if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
                }, HEARTBEAT_MS);
                const close = () => {
                    if (closed) return;
                    closed = true;
                    clearInterval(heartbeat);
                    subscription.unsubscribe();
                    try {
                        controller.close();
                    } catch {
                        /* already closed by the client */
                    }
                };
                const finish = (status: string) => {
                    send({ type: 'done', status });
                    close();
                };

                // Listeners and buffer come from the same tick: nothing emitted in between can be missed.
                const subscription = subscribe(jobId, {
                    onLog: (entry) => send({ type: 'log', ...entry }),
                    onStatus: (event) =>
                        send({
                            type: 'status',
                            status: event.status,
                            domain,
                            startedAt: event.startedAt,
                        }),
                    onDone: finish,
                });
                request.signal.addEventListener('abort', close);

                send({
                    type: 'status',
                    status: job.status,
                    domain,
                    queuedAt: job.queuedAt,
                    startedAt: job.startedAt,
                    triggerType: job.triggerType,
                    fullDownload: job.fullDownload,
                    skipGit: job.skipGit,
                });
                for (const entry of subscription.lines) send({ type: 'log', ...entry });

                // The row read before the subscription may be stale. Every final status is written before `done` is emitted, so a fresh read settles it either way.
                const fresh = isActive(job.status) ? await getJob(jobId) : job;
                if (closed) return;
                if (!fresh) {
                    // The site was deleted while the backup ran; the row went with it.
                    finish('error');
                    return;
                }
                if (!isActive(fresh.status)) {
                    if (subscription.lines.length === 0) {
                        for (const entry of parseLog(fresh.log ?? ''))
                            send({ type: 'log', ...entry });
                    }
                    finish(fresh.status);
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    },
);
