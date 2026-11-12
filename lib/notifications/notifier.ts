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
        notifyBackupFailed(event.jobId).catch((error) => {
            console.error(`[notify] backup ${event.jobId}: ${errorMessage(error)}`);
        });
    });
}

/** Mails the failure of one backup. Returns false when nothing was sent: notifications off, SMTP incomplete, or the row gone (the site was deleted during the run). */
export async function notifyBackupFailed(
    jobId: number,
    send: MailSender = sendMail,
): Promise<boolean> {
    const settings = await getSettings();
    if (!settings.notifyOnError) return false;
    const config = await getMailConfig(settings);
    if (!config) return false;

    const backup = await prisma.job.findUnique({
        where: { id: jobId },
        include: { site: { select: { id: true, domain: true } } },
    });
    if (!backup || backup.status !== 'error') return false;

    const result = await send(
        config,
        failureMail({
            domain: backup.site.domain,
            siteId: backup.site.id,
            jobId: backup.id,
            triggerType: backup.triggerType,
            startedAt: backup.startedAt,
            finishedAt: backup.finishedAt,
            durationMs: backup.durationMs,
            errorMessage: backup.errorMessage,
            log: backup.log,
            appUrl: appUrl(),
            timeZone: process.env.TZ || undefined,
        }),
    );
    logResult(`backup ${jobId}`, result);
    return true;
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
