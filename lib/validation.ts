import { z } from 'zod';
import { validate as validateCron } from 'node-cron';
import {
    JOB_KINDS,
    JOB_STATUSES,
    JOB_VIEWS,
    PROTOCOLS,
    SECRET_MASK,
    SMTP_SECURITIES,
} from './constants';

// The constants live in `constants.ts` (browser-safe); re-exported so server code keeps one import.
export {
    ACTIVE_STATUSES,
    JOB_KINDS,
    JOB_STATUSES,
    PROTOCOLS,
    SECRET_MASK,
    SMTP_SECURITIES,
    TRIGGER_TYPES,
    isActive,
} from './constants';
export type {
    ActiveStatus,
    JobKind,
    JobStatus,
    JobView,
    SmtpSecurity,
    TriggerType,
} from './constants';
import type { JobView } from './constants';

// ============ Field schemas ============

// Hostname: labels of letters, digits and hyphens, at least one dot, no leading/trailing hyphen.
const HOSTNAME = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
// Folder name used under FILES_DIR: no separators, no "." or "..".
const REPO_NAME = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;
// Only GitHub over HTTPS, no credentials in the URL.
const GITHUB_HTTPS_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(\.git)?$/;

export const domainSchema = z
    .string()
    .trim()
    .toLowerCase()
    .regex(HOSTNAME, 'Must be a valid hostname (e.g. mysite.com)');

export const repoNameSchema = z
    .string()
    .trim()
    .regex(REPO_NAME, 'Letters, digits, dots, dashes and underscores only');

export const repoUrlSchema = z
    .string()
    .trim()
    .regex(GITHUB_HTTPS_URL, 'Must be https://github.com/<owner>/<repo>.git')
    .transform((url) => (url.endsWith('.git') ? url : `${url}.git`));

/** Path of the site under the FTP/SFTP root. Empty string means the root itself. */
export const webRootPathSchema = z
    .string()
    .trim()
    .transform((value) => value.replace(/^\/+|\/+$/g, ''))
    .refine(
        (value) =>
            !value.includes('\\') &&
            !value.split('/').some((segment) => segment === '..' || segment === '.'),
        'Invalid path',
    );

export const cronSchema = z.string().trim().refine(validateCron, 'Invalid cron expression');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Mail recipients typed as one line: any mix of commas, semicolons and spaces between addresses. Stored normalized as `a@x, b@y`, null when empty. */
export const recipientsSchema = z
    .string()
    .nullable()
    .default(null)
    .transform((value) =>
        (value ?? '')
            .split(/[\s,;]+/)
            .filter(Boolean)
            .map((address) => address.toLowerCase()),
    )
    .pipe(z.array(z.email('Invalid email address')))
    .transform((list) => (list.length > 0 ? list.join(', ') : null));

export const passwordSchema = z.string().min(12, 'At least 12 characters');

// ============ Sites ============

export const siteCreateSchema = z.object({
    domain: domainSchema,
    repo: repoNameSchema,
    repoUrl: repoUrlSchema,
    protocol: z.enum(PROTOCOLS),
    host: z.string().trim().min(1, 'Required'),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1, 'Required'),
    password: z.string().min(1, 'Required'),
    webRootPath: webRootPathSchema.default('www'),
    spListItemId: z
        .string()
        .trim()
        .nullable()
        .default(null)
        .transform((value) => value || null),
    cronSchedule: cronSchema.nullable().default(null),
    enabled: z.boolean().default(true),
    inventoryCronSchedule: cronSchema.nullable().default(null),
    inventoryEnabled: z.boolean().default(true),
});

/** Same as create, but an empty or missing password keeps the stored one. */
export const siteUpdateSchema = siteCreateSchema.extend({
    password: z
        .string()
        .optional()
        .transform((value) => value || undefined),
});

export type SiteCreateInput = z.infer<typeof siteCreateSchema>;
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>;

/** Connection fields of the site form, tested before the site is saved. An empty password means "the stored one" when a site id is known. */
export const connectionTestSchema = siteCreateSchema
    .pick({ protocol: true, host: true, port: true, username: true, webRootPath: true })
    .extend({
        password: z
            .string()
            .optional()
            .transform((value) => value || undefined),
    });

export type ConnectionTestInput = z.infer<typeof connectionTestSchema>;

// ============ Settings ============

const optionalText = z
    .string()
    .trim()
    .nullable()
    .default(null)
    .transform((value) => value || null);

const optionalEmail = emailSchema
    .nullable()
    .default(null)
    .or(z.literal('').transform(() => null));

/** Plain secret to store, or empty/masked value to keep the current one. */
const storedSecret = z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value !== SECRET_MASK ? value : undefined));

const smtpFields = {
    notifyTo: recipientsSchema,
    smtpHost: optionalText,
    smtpPort: z.number().int().min(1).max(65535).default(587),
    smtpSecurity: z.enum(SMTP_SECURITIES).default('starttls'),
    smtpUser: optionalText,
    smtpPassword: storedSecret,
    smtpFrom: optionalEmail,
};

export const settingsSchema = z
    .object({
        githubName: optionalText,
        githubEmail: optionalEmail,
        githubToken: storedSecret,
        spTenantId: optionalText,
        spClientId: optionalText,
        spCertThumbprint: optionalText,
        spTenantName: optionalText,
        spSiteName: optionalText,
        spListName: optionalText,
        spDateField: optionalText,
        defaultCron: cronSchema,
        concurrency: z.number().int().min(1).max(5),
        retentionDays: z.number().int().min(1).max(3650),
        defaultInventoryCron: cronSchema,
        inventoryRetentionDays: z.number().int().min(1).max(3650),
        notifyOnError: z.boolean().default(false),
        notifyOnInventoryError: z.boolean().default(false),
        ...smtpFields,
    })
    .superRefine((data, ctx) => {
        // Notifications can only be switched on with a complete SMTP block: a silent misconfiguration would defeat the point.
        if (!data.notifyOnError && !data.notifyOnInventoryError) return;
        const missing = (['smtpHost', 'smtpFrom', 'notifyTo'] as const).filter((key) => !data[key]);
        for (const key of missing) {
            ctx.addIssue({
                code: 'custom',
                path: [key],
                message: 'Required to enable notifications',
            });
        }
    });

export type SettingsInput = z.infer<typeof settingsSchema>;

/** Token to check; empty or masked means the stored one. */
export const githubTestSchema = z.object({
    githubToken: storedSecret,
});

/** The SMTP block as typed in the form; an empty or masked password means the stored one. */
export const smtpTestSchema = z.object(smtpFields);

export type SmtpTestInput = z.infer<typeof smtpTestSchema>;

// ============ Jobs ============

export const runJobsSchema = z
    .object({
        kind: z.enum(JOB_KINDS).default('backup'),
        /** Omitted = every site that has this kind switched on. */
        siteIds: z.array(z.number().int().positive()).optional(),
        fullDownload: z.boolean().default(false),
        skipGit: z.boolean().default(false),
    })
    .refine((data) => data.kind === 'backup' || (!data.fullDownload && !data.skipGit), {
        message: 'fullDownload and skipGit only apply to a backup',
        path: ['kind'],
    });

export type RunJobsInput = z.infer<typeof runJobsSchema>;

export const jobsQuerySchema = z.object({
    /** Backups unless asked otherwise: inventories run daily and would drown them. */
    kind: z.enum([...JOB_KINDS, 'all']).default('backup'),
    siteId: z.coerce.number().int().positive().optional(),
    status: z.enum(JOB_STATUSES).optional(),
    /** A tab of the history: `active` or `issues`, each a set of statuses. */
    view: z.enum(Object.keys(JOB_VIEWS) as [JobView, ...JobView[]]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type JobsQuery = z.infer<typeof jobsQuerySchema>;

// ============ Auth ============

export const setupSchema = z
    .object({
        email: emailSchema,
        password: passwordSchema,
        passwordConfirmation: z.string(),
    })
    .refine((data) => data.password === data.passwordConfirmation, {
        message: 'Passwords do not match',
        path: ['passwordConfirmation'],
    });

export const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Required'),
});

export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, 'Required'),
        newPassword: passwordSchema,
        passwordConfirmation: z.string(),
    })
    .refine((data) => data.newPassword === data.passwordConfirmation, {
        message: 'Passwords do not match',
        path: ['passwordConfirmation'],
    });

// ============ Helpers ============

/** Route id segment → positive integer, or null when malformed. */
export function parseId(value: string): number | null {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}
