import path from 'node:path';
import { Prisma } from './generated/prisma/client';
import type { Job, Settings, Site, SiteComponent, User } from './generated/prisma/client';
import type { Role } from './auth';
import { decrypt, encrypt } from './crypto';
import { DEFAULT_AUTHOR_NAME } from './engine/git';
import type { CmsId, Component, Inventory } from './engine/inventory/types';
import type { GristConfig, SiteSnapshot } from './grist/sync';
import type { ComponentRow } from './inventory';
import type {
    GithubConfig,
    Protocol,
    RunOutcome,
    SharePointConfig,
    SiteConfig,
} from './engine/types';
import type { MailConfig } from './notifications/mailer';
import { spCertDir } from './paths';
import { prisma } from './prisma';
import { JOB_VIEWS } from './constants';
import { ACTIVE_STATUSES, SECRET_MASK } from './validation';
import type {
    ActiveStatus,
    JobKind,
    JobView,
    JobsQuery,
    SettingsInput,
    SiteCreateInput,
    SiteUpdateInput,
    SmtpSecurity,
} from './validation';

// ============ Users ============

/** Every User column except the password hash: the shape exposed to pages and the API. */
export const userSelect = {
    id: true,
    email: true,
    role: true,
    createdAt: true,
    lastLoginAt: true,
} satisfies Prisma.UserSelect;

export type UserSummary = Omit<User, 'passwordHash'>;

export function countUsers(): Promise<number> {
    return prisma.user.count();
}

export function getUser(id: number): Promise<UserSummary | null> {
    return prisma.user.findUnique({ where: { id }, select: userSelect });
}

/** Full row including the hash: login and password change only. */
export function findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
}

export function getPasswordHash(id: number): Promise<string | null> {
    return prisma.user
        .findUnique({ where: { id }, select: { passwordHash: true } })
        .then((user) => user?.passwordHash ?? null);
}

export function createUser(
    email: string,
    passwordHash: string,
    role: Role = 'admin',
): Promise<UserSummary> {
    return prisma.user.create({ data: { email, passwordHash, role }, select: userSelect });
}

export async function touchLastLogin(id: number): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

export async function setPasswordHash(id: number, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
}

// ============ Sites ============

/** Every Site column except the encrypted password: the shape exposed to pages and the API. */
export const siteSelect = {
    id: true,
    domain: true,
    repo: true,
    repoUrl: true,
    protocol: true,
    host: true,
    port: true,
    username: true,
    webRootPath: true,
    spListItemId: true,
    cronSchedule: true,
    enabled: true,
    createdAt: true,
    updatedAt: true,
    cms: true,
    cmsVersion: true,
    inventoryAt: true,
    inventoryEnabled: true,
    inventoryCronSchedule: true,
    gristSyncedAt: true,
    gristSyncError: true,
} satisfies Prisma.SiteSelect;

export type SiteSummary = Omit<Site, 'passwordEnc'>;

export function listSites(): Promise<SiteSummary[]> {
    return prisma.site.findMany({ select: siteSelect, orderBy: { domain: 'asc' } });
}

/** For the sidebar badge: the shell has no use for the rows themselves. */
export function countSites(): Promise<number> {
    return prisma.site.count();
}

export function getSite(id: number): Promise<SiteSummary | null> {
    return prisma.site.findUnique({ where: { id }, select: siteSelect });
}

export function createSite(input: SiteCreateInput): Promise<SiteSummary> {
    const { password, ...data } = input;
    return prisma.site.create({
        data: { ...data, passwordEnc: encrypt(password) },
        select: siteSelect,
    });
}

/** An undefined password keeps the stored one. */
export function updateSite(id: number, input: SiteUpdateInput): Promise<SiteSummary> {
    const { password, ...data } = input;
    return prisma.site.update({
        where: { id },
        data: { ...data, ...(password ? { passwordEnc: encrypt(password) } : {}) },
        select: siteSelect,
    });
}

export async function deleteSite(id: number): Promise<void> {
    await prisma.site.delete({ where: { id } });
}

export type SiteWithLastBackup = SiteSummary & { lastBackup: JobRow | null };

export async function listSitesWithLastBackup(): Promise<SiteWithLastBackup[]> {
    const sites = await prisma.site.findMany({
        select: {
            ...siteSelect,
            jobs: {
                where: { kind: 'backup' },
                orderBy: { queuedAt: 'desc' },
                take: 1,
                omit: { log: true },
            },
        },
        orderBy: { domain: 'asc' },
    });
    return sites.map(({ jobs, ...site }) => ({ ...site, lastBackup: jobs[0] ?? null }));
}

/** True when a Prisma error is a unique constraint violation (duplicate domain or repo). */
export function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ============ Jobs ============

/** A Job without its log: lists never carry the log text, only the detail does. */
export type JobRow = Omit<Job, 'log'>;

export type JobWithDomain = JobRow & { site: { domain: string } };

export type JobDetail = Job & { site: { domain: string } };

export interface JobPage {
    items: JobWithDomain[];
    total: number;
    page: number;
    pageSize: number;
}

/** The kind and site filters of a query, without its status or view. */
function jobsScope(query: Pick<JobsQuery, 'kind' | 'siteId'>): Prisma.JobWhereInput {
    return {
        ...(query.kind === 'all' ? {} : { kind: query.kind }),
        ...(query.siteId ? { siteId: query.siteId } : {}),
    };
}

export async function listJobs(query: JobsQuery): Promise<JobPage> {
    const where: Prisma.JobWhereInput = {
        ...jobsScope(query),
        ...(query.view ? { status: { in: [...JOB_VIEWS[query.view]] } } : {}),
        ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
        prisma.job.findMany({
            where,
            omit: { log: true },
            include: { site: { select: { domain: true } } },
            orderBy: { queuedAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
        }),
        prisma.job.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
}

/** How many jobs each tab of the history holds, under the same kind and site filters as the list. */
export async function countJobViews(
    query: Pick<JobsQuery, 'kind' | 'siteId'>,
): Promise<Record<'all' | JobView, number>> {
    const groups = await prisma.job.groupBy({
        by: ['status'],
        where: jobsScope(query),
        _count: { _all: true },
    });
    const count = (statuses?: readonly string[]) =>
        groups
            .filter((group) => !statuses || statuses.includes(group.status))
            .reduce((total, group) => total + group._count._all, 0);
    return { all: count(), active: count(JOB_VIEWS.active), issues: count(JOB_VIEWS.issues) };
}

export function getJob(id: number): Promise<JobDetail | null> {
    return prisma.job.findUnique({
        where: { id },
        include: { site: { select: { domain: true } } },
    });
}

export interface ActiveJob {
    id: number;
    siteId: number;
    domain: string;
    kind: JobKind;
    status: ActiveStatus;
}

/** Jobs still in the queue or executing, oldest first. The queue state is the database. */
export async function listActiveJobs(): Promise<ActiveJob[]> {
    const rows = await prisma.job.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        select: {
            id: true,
            siteId: true,
            kind: true,
            status: true,
            site: { select: { domain: true } },
        },
        orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
        id: row.id,
        siteId: row.siteId,
        domain: row.site.domain,
        kind: row.kind as JobKind,
        status: row.status as ActiveStatus,
    }));
}

// ============ Inventory ============

/** Stores a complete inventory: the CMS and its version on the site row, the components replaced as a whole. One batch, so a reader never sees half of it. Rejects when the site is gone. */
export async function saveInventory(
    siteId: number,
    inventory: Inventory,
    readAt: Date,
): Promise<void> {
    await prisma.$transaction([
        prisma.site.update({
            where: { id: siteId },
            data: { cms: inventory.cms, cmsVersion: inventory.version, inventoryAt: readAt },
        }),
        prisma.siteComponent.deleteMany({ where: { siteId } }),
        prisma.siteComponent.createMany({
            data: inventory.components.map((component) => ({ siteId, ...component })),
        }),
    ]);
}

/** The components of the last complete inventory, by type then slug. */
export function listSiteComponents(siteId: number): Promise<SiteComponent[]> {
    return prisma.siteComponent.findMany({
        where: { siteId },
        orderBy: [{ type: 'asc' }, { slug: 'asc' }],
    });
}

export function countSiteComponents(siteId: number): Promise<number> {
    return prisma.siteComponent.count({ where: { siteId } });
}

/** The most recent inventory run of a site, finished or not, without its log. A backup that read the inventory on its way is not one. */
export function getLastInventoryJob(siteId: number): Promise<JobRow | null> {
    return prisma.job.findFirst({
        where: { siteId, kind: 'inventory' },
        orderBy: { id: 'desc' },
        omit: { log: true },
    });
}

/** A site with what its last inventory found, for the cross-site view. */
export interface SiteInventory {
    id: number;
    domain: string;
    cms: string | null;
    cmsVersion: string | null;
    inventoryAt: Date | null;
    inventoryEnabled: boolean;
    /** Number of components per type, absent types included as zero by the reader. */
    counts: Record<string, number>;
}

export async function listSiteInventories(): Promise<SiteInventory[]> {
    const sites = await prisma.site.findMany({
        select: {
            id: true,
            domain: true,
            cms: true,
            cmsVersion: true,
            inventoryAt: true,
            inventoryEnabled: true,
            components: { select: { type: true } },
        },
        orderBy: { domain: 'asc' },
    });
    return sites.map(({ components, ...site }) => {
        const counts: Record<string, number> = {};
        for (const { type } of components) counts[type] = (counts[type] ?? 0) + 1;
        return { ...site, counts };
    });
}

/** Every component of every site, with the site it is installed on and the CMS that site runs. */
export async function listInstalledComponents(): Promise<ComponentRow[]> {
    const rows = await prisma.siteComponent.findMany({
        select: {
            type: true,
            slug: true,
            name: true,
            version: true,
            site: { select: { id: true, domain: true, cms: true } },
        },
    });
    // Components and the CMS are stored in one batch, so a site that has components has a CMS.
    return rows.map(({ site: { cms, ...site }, ...row }) => ({ ...row, cms: cms ?? '', site }));
}

// ============ Grist ============

/**
 * What Grist is told of a site, read in one go: the last complete inventory, and three facts drawn from its backups, each from the run that carries it (the last one that succeeded, the last one that ended whatever its outcome, the last one that created a Release). `baseUrl` is the public URL of the app, for the link back to the site. Null when the site is gone.
 */
export async function getSiteSnapshot(
    siteId: number,
    baseUrl: string | null,
): Promise<SiteSnapshot | null> {
    const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
            domain: true,
            cms: true,
            cmsVersion: true,
            inventoryAt: true,
            components: {
                select: { type: true, slug: true, name: true, version: true },
                orderBy: [{ type: 'asc' }, { slug: 'asc' }],
            },
        },
    });
    if (!site) return null;

    const backups = { siteId, kind: 'backup' };
    const [succeeded, ended, released] = await Promise.all([
        prisma.job.findFirst({
            where: { ...backups, status: 'success' },
            orderBy: { id: 'desc' },
            select: { finishedAt: true },
        }),
        prisma.job.findFirst({
            where: { ...backups, status: { notIn: [...ACTIVE_STATUSES] } },
            orderBy: { id: 'desc' },
            select: { status: true },
        }),
        prisma.job.findFirst({
            where: { ...backups, releaseUrl: { not: null } },
            orderBy: { id: 'desc' },
            select: { releaseUrl: true },
        }),
    ]);

    return {
        domain: site.domain,
        cms: site.cms as CmsId | null,
        cmsVersion: site.cmsVersion,
        inventoryAt: site.inventoryAt,
        components: site.components as Component[],
        lastBackupAt: succeeded?.finishedAt ?? null,
        lastBackupStatus: (ended?.status as RunOutcome | undefined) ?? null,
        lastBackupUrl: released?.releaseUrl ?? null,
        repositeUrl: baseUrl ? `${baseUrl}/sites/${siteId}` : null,
    };
}

/** Keeps the outcome of a push on the site row: the date when it went through, the reason when it did not (the date of the last good one stays). `updateMany`: the site may have been deleted meanwhile. */
export async function recordGristSync(siteId: number, error: string | null): Promise<void> {
    await prisma.site.updateMany({
        where: { id: siteId },
        data:
            error === null
                ? { gristSyncedAt: new Date(), gristSyncError: null }
                : { gristSyncError: error },
    });
}

// ============ Settings ============

/** The singleton row, created with defaults on first access. A plain read afterwards: `upsert` would take a write transaction on every call. */
export async function getSettings(): Promise<Settings> {
    const existing = await prisma.settings.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    try {
        return await prisma.settings.create({ data: { id: 1 } });
    } catch (error) {
        // Two first calls at once: the loser reads the row the winner created.
        if (!isUniqueViolation(error)) throw error;
        return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    }
}

/** Settings as the page and the API expose them: the secrets never leave the server, only whether one is stored (`SECRET_MASK`). Sending the mask back keeps it. */
export type SettingsView = Omit<
    Settings,
    'githubTokenEnc' | 'smtpPasswordEnc' | 'gristApiKeyEnc'
> & {
    githubToken: string;
    smtpPassword: string;
    gristApiKey: string;
};

export function toSettingsView(settings: Settings): SettingsView {
    const { githubTokenEnc, smtpPasswordEnc, gristApiKeyEnc, ...rest } = settings;
    return {
        ...rest,
        githubToken: githubTokenEnc ? SECRET_MASK : '',
        smtpPassword: smtpPasswordEnc ? SECRET_MASK : '',
        gristApiKey: gristApiKeyEnc ? SECRET_MASK : '',
    };
}

/** An undefined secret keeps the stored one. The caller reloads the scheduler: `defaultCron` may have changed. */
export async function updateSettings(input: SettingsInput): Promise<Settings> {
    await getSettings();
    const { githubToken, smtpPassword, gristApiKey, ...data } = input;
    return prisma.settings.update({
        where: { id: 1 },
        data: {
            ...data,
            ...(githubToken ? { githubTokenEnc: encrypt(githubToken) } : {}),
            ...(smtpPassword ? { smtpPasswordEnc: encrypt(smtpPassword) } : {}),
            ...(gristApiKey ? { gristApiKeyEnc: encrypt(gristApiKey) } : {}),
        },
    });
}

// ============ Engine configs (decrypted) ============

export async function getSiteConfig(id: number): Promise<SiteConfig | null> {
    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return null;
    return {
        domain: site.domain,
        repo: site.repo,
        repoUrl: site.repoUrl,
        protocol: site.protocol as Protocol,
        host: site.host,
        port: site.port,
        username: site.username,
        password: decrypt(site.passwordEnc),
        webRootPath: site.webRootPath,
        spListItemId: site.spListItemId,
        inventoryEnabled: site.inventoryEnabled,
    };
}

/** The decrypted GitHub token alone, for the token check in Settings. */
export async function getGithubToken(): Promise<string | null> {
    const settings = await getSettings();
    return settings.githubTokenEnc ? decrypt(settings.githubTokenEnc) : null;
}

/** Null until both the token and the commit email are configured. The author name falls back to the engine default. */
export async function getGithubConfig(): Promise<GithubConfig | null> {
    const settings = await getSettings();
    if (!settings.githubTokenEnc || !settings.githubEmail) return null;
    return {
        name: settings.githubName || DEFAULT_AUTHOR_NAME,
        email: settings.githubEmail,
        token: decrypt(settings.githubTokenEnc),
    };
}

/** The SMTP columns without the password, as stored or as typed in the form. */
export type MailFields = Pick<
    Settings,
    'smtpHost' | 'smtpPort' | 'smtpSecurity' | 'smtpUser' | 'smtpFrom' | 'notifyTo'
>;

/** Null until host, sender and at least one recipient are set. The password is taken separately so the SMTP test can use the typed one. */
export function toMailConfig(fields: MailFields, password: string | null): MailConfig | null {
    if (!fields.smtpHost || !fields.smtpFrom || !fields.notifyTo) return null;
    return {
        host: fields.smtpHost,
        port: fields.smtpPort,
        security: fields.smtpSecurity as SmtpSecurity,
        user: fields.smtpUser,
        password,
        from: fields.smtpFrom,
        to: fields.notifyTo.split(',').map((address) => address.trim()),
    };
}

export async function getSmtpPassword(settings: Settings): Promise<string | null> {
    return settings.smtpPasswordEnc ? decrypt(settings.smtpPasswordEnc) : null;
}

/** Decrypted SMTP configuration, or null while incomplete. Does not look at `notifyOnError`: that switch belongs to the notifier, the test button works either way. */
export async function getMailConfig(settings?: Settings): Promise<MailConfig | null> {
    const s = settings ?? (await getSettings());
    return toMailConfig(s, await getSmtpPassword(s));
}

/** The Grist columns without the key, as stored or as typed in the form. */
export type GristFields = Pick<
    Settings,
    'gristUrl' | 'gristDocId' | 'gristSitesTable' | 'gristComponentsTable'
>;

/** Null until the server, the key, the document and the sites table are set. The key is taken separately so the test can use the typed one. */
export function toGristConfig(fields: GristFields, apiKey: string | null): GristConfig | null {
    if (!fields.gristUrl || !apiKey || !fields.gristDocId || !fields.gristSitesTable) return null;
    return {
        serverUrl: fields.gristUrl,
        apiKey,
        docId: fields.gristDocId,
        sitesTable: fields.gristSitesTable,
        componentsTable: fields.gristComponentsTable,
    };
}

export async function getGristApiKey(settings: Settings): Promise<string | null> {
    return settings.gristApiKeyEnc ? decrypt(settings.gristApiKeyEnc) : null;
}

/** Decrypted Grist configuration, or null while the push is off. */
export async function getGristConfig(settings?: Settings): Promise<GristConfig | null> {
    const s = settings ?? (await getSettings());
    return toGristConfig(s, await getGristApiKey(s));
}

/** Null unless every SharePoint field is filled in. */
export async function getSharePointConfig(): Promise<SharePointConfig | null> {
    const s = await getSettings();
    if (
        !s.spTenantId ||
        !s.spClientId ||
        !s.spCertThumbprint ||
        !s.spTenantName ||
        !s.spSiteName ||
        !s.spListName ||
        !s.spDateField
    ) {
        return null;
    }
    return {
        tenantId: s.spTenantId,
        clientId: s.spClientId,
        certThumbprint: s.spCertThumbprint,
        tenantName: s.spTenantName,
        siteName: s.spSiteName,
        listName: s.spListName,
        dateField: s.spDateField,
        certPath: path.join(spCertDir(), 'key.pem'),
    };
}
