import path from 'node:path';
import { Prisma } from './generated/prisma/client';
import type { Backup, Settings, Site, User } from './generated/prisma/client';
import type { Role } from './auth';
import { decrypt, encrypt } from './crypto';
import { DEFAULT_AUTHOR_NAME } from './engine/git';
import type { GithubConfig, Protocol, SharePointConfig, SiteConfig } from './engine/types';
import type { MailConfig } from './notifications/mailer';
import { spCertDir } from './paths';
import { prisma } from './prisma';
import { ACTIVE_STATUSES, SECRET_MASK } from './validation';
import type {
    ActiveStatus,
    BackupsQuery,
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

export type SiteWithLastBackup = SiteSummary & { lastBackup: BackupRow | null };

export async function listSitesWithLastBackup(): Promise<SiteWithLastBackup[]> {
    const sites = await prisma.site.findMany({
        select: {
            ...siteSelect,
            backups: { orderBy: { queuedAt: 'desc' }, take: 1, omit: { log: true } },
        },
        orderBy: { domain: 'asc' },
    });
    return sites.map(({ backups, ...site }) => ({ ...site, lastBackup: backups[0] ?? null }));
}

/** True when a Prisma error is a unique constraint violation (duplicate domain or repo). */
export function isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ============ Backups ============

/** A Backup without its log: lists never carry the log text, only the detail does. */
export type BackupRow = Omit<Backup, 'log'>;

export type BackupWithDomain = BackupRow & { site: { domain: string } };

export type BackupDetail = Backup & { site: { domain: string } };

export interface BackupPage {
    items: BackupWithDomain[];
    total: number;
    page: number;
    pageSize: number;
}

export async function listBackups(query: BackupsQuery): Promise<BackupPage> {
    const where: Prisma.BackupWhereInput = {
        ...(query.siteId ? { siteId: query.siteId } : {}),
        ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await prisma.$transaction([
        prisma.backup.findMany({
            where,
            omit: { log: true },
            include: { site: { select: { domain: true } } },
            orderBy: { queuedAt: 'desc' },
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
        }),
        prisma.backup.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
}

export function getBackup(id: number): Promise<BackupDetail | null> {
    return prisma.backup.findUnique({
        where: { id },
        include: { site: { select: { domain: true } } },
    });
}

export interface ActiveBackup {
    id: number;
    siteId: number;
    domain: string;
    status: ActiveStatus;
}

/** Backups still in the queue or executing, oldest first. The queue state is the database. */
export async function listActiveBackups(): Promise<ActiveBackup[]> {
    const rows = await prisma.backup.findMany({
        where: { status: { in: [...ACTIVE_STATUSES] } },
        select: { id: true, siteId: true, status: true, site: { select: { domain: true } } },
        orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
        id: row.id,
        siteId: row.siteId,
        domain: row.site.domain,
        status: row.status as ActiveStatus,
    }));
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
export type SettingsView = Omit<Settings, 'githubTokenEnc' | 'smtpPasswordEnc'> & {
    githubToken: string;
    smtpPassword: string;
};

export function toSettingsView(settings: Settings): SettingsView {
    const { githubTokenEnc, smtpPasswordEnc, ...rest } = settings;
    return {
        ...rest,
        githubToken: githubTokenEnc ? SECRET_MASK : '',
        smtpPassword: smtpPasswordEnc ? SECRET_MASK : '',
    };
}

/** An undefined secret keeps the stored one. The caller reloads the scheduler: `defaultCron` may have changed. */
export async function updateSettings(input: SettingsInput): Promise<Settings> {
    await getSettings();
    const { githubToken, smtpPassword, ...data } = input;
    return prisma.settings.update({
        where: { id: 1 },
        data: {
            ...data,
            ...(githubToken ? { githubTokenEnc: encrypt(githubToken) } : {}),
            ...(smtpPassword ? { smtpPasswordEnc: encrypt(smtpPassword) } : {}),
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
