/**
 * Enumerations shared by the server and the browser. No import here on purpose: `validation.ts` pulls node-cron, which cannot be bundled for the client, so client components take their constants from this file.
 */

export const PROTOCOLS = ['ftp', 'sftp'] as const;
/** What a job does: a snapshot of the site, or a reading of what runs on it. */
export const JOB_KINDS = ['backup', 'inventory'] as const;
export const JOB_STATUSES = ['pending', 'running', 'success', 'error', 'cancelled'] as const;
export const TRIGGER_TYPES = ['manual', 'scheduled'] as const;
/** How the SMTP connection is secured: implicit TLS (465), STARTTLS upgrade (587), or nothing. */
export const SMTP_SECURITIES = ['tls', 'starttls', 'none'] as const;

export type Protocol = (typeof PROTOCOLS)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type TriggerType = (typeof TRIGGER_TYPES)[number];
export type SmtpSecurity = (typeof SMTP_SECURITIES)[number];

/** Statuses of a job that is still in the queue or executing. */
export const ACTIVE_STATUSES = ['pending', 'running'] as const satisfies readonly JobStatus[];

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/** The tabs of the history, each a set of statuses: what is still going, and what did not end well, a cancellation included. */
export const JOB_VIEWS = {
    active: ACTIVE_STATUSES,
    issues: ['error', 'cancelled'],
} as const satisfies Record<string, readonly JobStatus[]>;

export type JobView = keyof typeof JOB_VIEWS;

export function isActive(status: string): status is ActiveStatus {
    return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

/** What the API returns in place of a stored secret. Sending it back leaves the secret unchanged. */
export const SECRET_MASK = '••••••';
