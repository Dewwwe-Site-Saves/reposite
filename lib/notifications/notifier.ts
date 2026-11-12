import type { JobKind } from '../constants';
import { getMailConfig, getSettings } from '../db';
import { errorMessage } from '../engine/cancel';
import { appUrl } from '../env';
import { events, type DoneEvent } from '../jobs/queue';
import { prisma } from '../prisma';
import { sendMail, type MailSender, type SendResult } from './mailer';
import { failureMail, interruptedMail } from './templates';

/**
 * Turns queue outcomes into mails. `start` subscribes once to the queue's `done` event (process-wide flag, like the queue itself); the boot hook calls it. A mail that cannot be sent is logged and dropped: a notification must never affect a run, and there is nobody to tell about a broken mail server except the console.
 */

const globalForNotifier = globalThis as unknown as { backupNotifier?: { started: boolean } };
const state = (globalForNotifier.backupNotifier ??= { started: false });

export function start(): void {
    if (state.started) return;
    state.started = true;
    events.on('done', (event: DoneEvent) => {
        if (event.status !== 'error') return;
        notifyJobFailed(event.jobId).catch((error) => {
            console.error(`[notify] job ${event.jobId}: ${errorMessage(error)}`);
        });
    });
}

/**
 * Mails the failure of one job. A backup is mailed every time (`Settings.notifyOnError`). An inventory runs every day, so only the first failure of a series is (`Settings.notifyOnInventoryError`): nothing is sent while the site's previous inventory run had failed too. Returns false when nothing was sent: switch off, SMTP incomplete, repeated inventory failure, or the row gone (the site was deleted during the run).
 */
export async function notifyJobFailed(
    jobId: number,
    send: MailSender = sendMail,
): Promise<boolean> {
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { site: { select: { id: true, domain: true } } },
    });
    if (!job || job.status !== 'error') return false;
    const kind = job.kind as JobKind;

    const settings = await getSettings();
    if (!(kind === 'inventory' ? settings.notifyOnInventoryError : settings.notifyOnError)) {
        return false;
    }
    if (kind === 'inventory' && (await previousInventoryFailed(job.siteId, job.id))) return false;
    const config = await getMailConfig(settings);
    if (!config) return false;

    const result = await send(
        config,
        failureMail({
            kind,
            domain: job.site.domain,
            siteId: job.site.id,
            jobId: job.id,
            triggerType: job.triggerType,
            startedAt: job.startedAt,
            finishedAt: job.finishedAt,
            durationMs: job.durationMs,
            errorMessage: job.errorMessage,
            log: job.log,
            appUrl: appUrl(),
            timeZone: process.env.TZ || undefined,
        }),
    );
    logResult(`${kind} ${jobId}`, result);
    return true;
}

/** The inventory run of the site that finished just before this one, cancelled runs aside: they say nothing about the site. */
async function previousInventoryFailed(siteId: number, jobId: number): Promise<boolean> {
    const previous = await prisma.job.findFirst({
        where: {
            siteId,
            kind: 'inventory',
            id: { lt: jobId },
            status: { in: ['success', 'error'] },
        },
        orderBy: { id: 'desc' },
        select: { status: true },
    });
    return previous?.status === 'error';
}

/** Partial refusals do not reject the send: they are only visible here. */
function logResult(what: string, result: SendResult): void {
    if (result.rejected.length > 0) {
        console.warn(
            `[notify] ${what}: recipients refused by the server: ${result.rejected.join(', ')}`,
        );
    }
}

/** One mail for the backups the boot sweep marked as interrupted. Same gating as a failure. */
export async function notifyInterrupted(
    domains: string[],
    send: MailSender = sendMail,
): Promise<boolean> {
    if (domains.length === 0) return false;
    const settings = await getSettings();
    if (!settings.notifyOnError) return false;
    const config = await getMailConfig(settings);
    if (!config) return false;

    const result = await send(
        config,
        interruptedMail({ domains, appUrl: appUrl(), timeZone: process.env.TZ || undefined }),
    );
    logResult('interrupted', result);
    return true;
}
