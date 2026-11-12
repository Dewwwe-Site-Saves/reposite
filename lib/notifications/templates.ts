import type { Mail } from './mailer';

/**
 * The mails the app sends, built from plain values so they can be tested without a transport. Text first, HTML is the same content in a table: mail clients that strip HTML still get everything.
 */

const SUBJECT_PREFIX = '[Reposite]';

/** Lines of the run log kept at the end of a failure mail. */
export const LOG_TAIL_LINES = 30;

export interface FailureMailInput {
    domain: string;
    siteId: number;
    jobId: number;
    triggerType: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number | null;
    errorMessage: string | null;
    log: string | null;
    /** Public URL of the app, null when unknown: the mail then carries no link. */
    appUrl: string | null;
    /** IANA name used to format the dates, defaults to the process timezone. */
    timeZone?: string;
}

export interface InterruptedMailInput {
    /** Domains of the backups swept at start-up, one entry per backup. */
    domains: string[];
    appUrl: string | null;
    timeZone?: string;
}

export function failureMail(input: FailureMailInput): Mail {
    const rows: [string, string][] = [
        ['Site', input.domain],
        ['Trigger', input.triggerType],
        ['Started', formatDate(input.startedAt, input.timeZone)],
        ['Finished', formatDate(input.finishedAt, input.timeZone)],
        ['Duration', input.durationMs === null ? '-' : formatDuration(input.durationMs)],
        ['Error', input.errorMessage ?? 'Unknown error'],
    ];
    const link = input.appUrl ? `${input.appUrl}/history?siteId=${input.siteId}` : null;
    const tail = logTail(input.log);

    const text = [
        `Backup #${input.jobId} of ${input.domain} failed.`,
        '',
        ...rows.map(([label, value]) => `${label}: ${value}`),
        ...(link ? ['', `History: ${link}`] : []),
        ...(tail.length > 0 ? ['', `Last ${tail.length} log lines:`, ...tail] : []),
    ].join('\n');

    const html = [
        `<p>Backup #${input.jobId} of <strong>${escapeHtml(input.domain)}</strong> failed.</p>`,
        table(rows),
        link ? `<p><a href="${escapeHtml(link)}">Open the history</a></p>` : '',
        tail.length > 0
            ? `<p>Last ${tail.length} log lines:</p><pre style="font-size:12px;white-space:pre-wrap">${escapeHtml(tail.join('\n'))}</pre>`
            : '',
    ].join('\n');

    return { subject: `${SUBJECT_PREFIX} Backup failed: ${input.domain}`, text, html };
}

export function interruptedMail(input: InterruptedMailInput): Mail {
    const count = input.domains.length;
    const noun = count === 1 ? 'backup' : 'backups';
    const link = input.appUrl ? `${input.appUrl}/history` : null;
    const intro = `${count} ${noun} interrupted by a server restart, marked as failed. The next scheduled run will catch up.`;

    const text = [
        intro,
        '',
        ...input.domains.map((d) => `- ${d}`),
        ...(link ? ['', `History: ${link}`] : []),
    ].join('\n');
    const html = [
        `<p>${escapeHtml(intro)}</p>`,
        `<ul>${input.domains.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
        link ? `<p><a href="${escapeHtml(link)}">Open the history</a></p>` : '',
    ].join('\n');

    return { subject: `${SUBJECT_PREFIX} ${count} ${noun} interrupted by a restart`, text, html };
}

export function testMail(input: { appUrl: string | null }): Mail {
    const text = [
        'This is a test message from Reposite: the SMTP settings work.',
        ...(input.appUrl ? ['', `Instance: ${input.appUrl}`] : []),
    ].join('\n');
    const html = [
        '<p>This is a test message from Reposite: the SMTP settings work.</p>',
        input.appUrl
            ? `<p>Instance: <a href="${escapeHtml(input.appUrl)}">${escapeHtml(input.appUrl)}</a></p>`
            : '',
    ].join('\n');
    return { subject: `${SUBJECT_PREFIX} Test message`, text, html };
}

function logTail(log: string | null): string[] {
    if (!log) return [];
    const lines = log.split('\n').filter((line) => line.trim() !== '');
    return lines.slice(-LOG_TAIL_LINES);
}

function formatDate(date: Date | null, timeZone?: string): string {
    if (!date) return '-';
    return date.toLocaleString('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms: number): string {
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function table(rows: [string, string][]): string {
    const body = rows
        .map(
            ([label, value]) =>
                `<tr><td style="padding:2px 12px 2px 0;color:#666">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`,
        )
        .join('');
    return `<table style="border-collapse:collapse">${body}</table>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
