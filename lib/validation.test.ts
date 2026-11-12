import { describe, expect, it } from 'vitest';
import {
    jobsQuerySchema,
    cronSchema,
    domainSchema,
    parseId,
    recipientsSchema,
    repoNameSchema,
    repoUrlSchema,
    runJobsSchema,
    settingsSchema,
    siteCreateSchema,
    siteUpdateSchema,
    webRootPathSchema,
} from './validation';

const validSite = {
    domain: 'MySite.com',
    repo: 'mysite',
    repoUrl: 'https://github.com/org/mysite',
    protocol: 'ftp',
    host: 'ftp.mysite.com',
    port: 21,
    username: 'user',
    password: 'pass',
};

describe('domainSchema', () => {
    it('accepts and normalises hostnames', () => {
        expect(domainSchema.parse(' MySite.com ')).toBe('mysite.com');
        expect(domainSchema.parse('sub.my-site.co.uk')).toBe('sub.my-site.co.uk');
    });

    it('rejects anything that is not a bare hostname', () => {
        for (const value of [
            'localhost',
            'my site.com',
            'https://mysite.com',
            'mysite.com/',
            '../etc',
            '-bad.com',
        ]) {
            expect(domainSchema.safeParse(value).success, value).toBe(false);
        }
    });
});

describe('repoNameSchema', () => {
    it('accepts simple folder names', () => {
        expect(repoNameSchema.parse('my-site_v2.backup')).toBe('my-site_v2.backup');
    });

    it('rejects path traversal and separators', () => {
        for (const value of ['..', '.', 'a/b', 'a\\b', 'a b', '', 'x; rm -rf /']) {
            expect(repoNameSchema.safeParse(value).success, value).toBe(false);
        }
    });
});

describe('repoUrlSchema', () => {
    it('accepts GitHub HTTPS urls and appends .git', () => {
        expect(repoUrlSchema.parse('https://github.com/org/repo')).toBe(
            'https://github.com/org/repo.git',
        );
        expect(repoUrlSchema.parse('https://github.com/org/repo.git')).toBe(
            'https://github.com/org/repo.git',
        );
    });

    it('rejects ssh urls, credentials and other hosts', () => {
        for (const value of [
            'git@github.com:org/repo.git',
            'https://user:token@github.com/org/repo.git',
            'https://gitlab.com/org/repo.git',
            'https://github.com/org',
            'https://github.com/org/repo.git; echo pwned',
        ]) {
            expect(repoUrlSchema.safeParse(value).success, value).toBe(false);
        }
    });
});

describe('webRootPathSchema', () => {
    it('strips surrounding slashes and allows the root', () => {
        expect(webRootPathSchema.parse('/www/')).toBe('www');
        expect(webRootPathSchema.parse('public_html/site')).toBe('public_html/site');
        expect(webRootPathSchema.parse('')).toBe('');
    });

    it('rejects traversal', () => {
        expect(webRootPathSchema.safeParse('www/../etc').success).toBe(false);
        expect(webRootPathSchema.safeParse('./www').success).toBe(false);
    });
});

describe('cronSchema', () => {
    it('accepts valid expressions', () => {
        expect(cronSchema.parse('0 3 * * *')).toBe('0 3 * * *');
        expect(cronSchema.parse('*/15 * * * *')).toBe('*/15 * * * *');
    });

    it('rejects garbage', () => {
        expect(cronSchema.safeParse('every day').success).toBe(false);
        expect(cronSchema.safeParse('0 25 * * *').success).toBe(false);
    });
});

describe('siteCreateSchema', () => {
    it('applies defaults and normalisation', () => {
        const site = siteCreateSchema.parse(validSite);
        expect(site.domain).toBe('mysite.com');
        expect(site.repoUrl).toBe('https://github.com/org/mysite.git');
        expect(site.webRootPath).toBe('www');
        expect(site.cronSchedule).toBeNull();
        expect(site.spListItemId).toBeNull();
        expect(site.enabled).toBe(true);
    });

    it('turns an empty SharePoint id into null', () => {
        expect(
            siteCreateSchema.parse({ ...validSite, spListItemId: '  ' }).spListItemId,
        ).toBeNull();
        expect(siteCreateSchema.parse({ ...validSite, spListItemId: '12' }).spListItemId).toBe(
            '12',
        );
    });

    it('requires a password on create but not on update', () => {
        expect(siteCreateSchema.safeParse({ ...validSite, password: '' }).success).toBe(false);
        expect(siteUpdateSchema.parse({ ...validSite, password: '' }).password).toBeUndefined();
        expect(siteUpdateSchema.parse({ ...validSite, password: 'new' }).password).toBe('new');
    });

    it('validates port range and protocol', () => {
        expect(siteCreateSchema.safeParse({ ...validSite, port: 0 }).success).toBe(false);
        expect(siteCreateSchema.safeParse({ ...validSite, port: 70000 }).success).toBe(false);
        expect(siteCreateSchema.safeParse({ ...validSite, protocol: 'scp' }).success).toBe(false);
    });
});

describe('recipientsSchema', () => {
    it('normalises any separator to a comma-separated list, empty to null', () => {
        expect(recipientsSchema.parse(' A@x.com; b@y.org  c@z.net,')).toBe(
            'a@x.com, b@y.org, c@z.net',
        );
        expect(recipientsSchema.parse('')).toBeNull();
        expect(recipientsSchema.parse(null)).toBeNull();
        expect(recipientsSchema.parse(undefined)).toBeNull();
    });

    it('rejects a list with one bad address', () => {
        expect(recipientsSchema.safeParse('a@x.com, nope').success).toBe(false);
    });
});

describe('settingsSchema', () => {
    const base = {
        defaultCron: '0 2 * * *',
        concurrency: 2,
        retentionDays: 90,
        defaultInventoryCron: '0 4 * * *',
        inventoryRetentionDays: 14,
    };

    it('refuses to enable notifications without host, sender and recipients', () => {
        const result = settingsSchema.safeParse({ ...base, notifyOnError: true });
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map((issue) => issue.path.join('.')).sort();
        expect(paths).toEqual(['notifyTo', 'smtpFrom', 'smtpHost']);
    });

    it('asks for the same SMTP block when only the inventory alerts are switched on', () => {
        const result = settingsSchema.safeParse({ ...base, notifyOnInventoryError: true });
        expect(result.success).toBe(false);
        expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual([
            'notifyTo',
            'smtpFrom',
            'smtpHost',
        ]);
    });

    it('accepts an incomplete SMTP block while notifications are off', () => {
        const result = settingsSchema.parse({ ...base, smtpHost: 'smtp.example.com' });
        expect(result).toMatchObject({
            notifyOnError: false,
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpSecurity: 'starttls',
            notifyTo: null,
        });
    });

    it('treats an empty or masked password as "keep"', () => {
        expect(settingsSchema.parse({ ...base, smtpPassword: '' }).smtpPassword).toBeUndefined();
        expect(
            settingsSchema.parse({ ...base, smtpPassword: '••••••' }).smtpPassword,
        ).toBeUndefined();
        expect(settingsSchema.parse({ ...base, smtpPassword: 'pw' }).smtpPassword).toBe('pw');
    });
});

describe('jobsQuerySchema', () => {
    it('coerces query strings with defaults', () => {
        expect(jobsQuerySchema.parse({})).toEqual({ kind: 'backup', page: 1, pageSize: 20 });
        expect(
            jobsQuerySchema.parse({ siteId: '3', status: 'error', page: '2', pageSize: '50' }),
        ).toEqual({
            kind: 'backup',
            siteId: 3,
            status: 'error',
            page: 2,
            pageSize: 50,
        });
    });

    it('lists backups unless another kind, or all of them, is asked for', () => {
        expect(jobsQuerySchema.parse({ kind: 'inventory' }).kind).toBe('inventory');
        expect(jobsQuerySchema.parse({ kind: 'all' }).kind).toBe('all');
        expect(jobsQuerySchema.safeParse({ kind: 'scan' }).success).toBe(false);
    });

    it('rejects unknown statuses and oversized pages', () => {
        expect(jobsQuerySchema.safeParse({ status: 'done' }).success).toBe(false);
        expect(jobsQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    });
});

describe('runJobsSchema', () => {
    it('queues backups by default', () => {
        expect(runJobsSchema.parse({})).toEqual({
            kind: 'backup',
            fullDownload: false,
            skipGit: false,
        });
    });

    it('accepts an inventory but none of the backup options with it', () => {
        expect(runJobsSchema.parse({ kind: 'inventory', siteIds: [3] }).kind).toBe('inventory');
        expect(runJobsSchema.safeParse({ kind: 'inventory', skipGit: true }).success).toBe(false);
        expect(runJobsSchema.safeParse({ kind: 'inventory', fullDownload: true }).success).toBe(
            false,
        );
    });
});

describe('parseId', () => {
    it('parses positive integers only', () => {
        expect(parseId('12')).toBe(12);
        for (const value of ['0', '-1', '1.5', 'abc', '', 'NaN']) {
            expect(parseId(value), value).toBeNull();
        }
    });
});
