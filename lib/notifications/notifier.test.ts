import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTestDatabase } from '../testing/db';
import type { Mail, MailConfig } from './mailer';

// The transport is replaced: everything else (Prisma, the crypto helpers, the settings loader) runs for real on a throwaway database.
const sent = vi.hoisted(() => [] as { config: MailConfig; mail: Mail }[]);

vi.mock('./mailer', () => ({
    sendMail: async (config: MailConfig, mail: Mail) => {
        sent.push({ config, mail });
        return { accepted: config.to, rejected: [], response: '250 OK' };
    },
}));

const { prisma, cleanup } = await setupTestDatabase();
const { encrypt } = await import('../crypto');
const queue = await import('../jobs/queue');
const notifier = await import('./notifier');

const SMTP = {
    notifyOnError: true,
    notifyTo: 'ops@example.com, me@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
    smtpUser: 'mailer',
    smtpPasswordEnc: encrypt('hunter2'),
    smtpFrom: 'reposite@example.com',
};

async function createBackup(status: string): Promise<number> {
    const site = await prisma.site.upsert({
        where: { domain: 'site.test' },
        update: {},
        create: {
            domain: 'site.test',
            repo: 'site-test',
            repoUrl: 'https://github.com/acme/site-test.git',
            host: 'ftp.example.com',
            port: 21,
            username: 'user',
            passwordEnc: encrypt('secret'),
        },
    });
    const backup = await prisma.job.create({
        data: {
            siteId: site.id,
            status,
            triggerType: 'scheduled',
            startedAt: new Date(),
            finishedAt: new Date(),
            durationMs: 1000,
            errorMessage: status === 'error' ? 'boom' : null,
            log: 'line 1\nline 2',
        },
        select: { id: true },
    });
    return backup.id;
}

beforeEach(async () => {
    sent.length = 0;
    await prisma.job.deleteMany();
    await prisma.settings.upsert({ where: { id: 1 }, update: SMTP, create: { id: 1, ...SMTP } });
    process.env.APP_URL = 'https://backups.example.com/';
});

afterAll(cleanup);

describe('notifyBackupFailed', () => {
    it('sends the failure mail with the decrypted SMTP configuration', async () => {
        const id = await createBackup('error');
        expect(await notifier.notifyBackupFailed(id)).toBe(true);

        expect(sent).toHaveLength(1);
        const { config, mail } = sent[0]!;
        expect(config).toEqual({
            host: 'smtp.example.com',
            port: 465,
            security: 'tls',
            user: 'mailer',
            password: 'hunter2',
            from: 'reposite@example.com',
            to: ['ops@example.com', 'me@example.com'],
        });
        expect(mail.subject).toBe('[Reposite] Backup failed: site.test');
        expect(mail.text).toContain('Error: boom');
        expect(mail.text).toContain('History: https://backups.example.com/history?siteId=');
    });

    it('sends nothing while the switch is off', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { notifyOnError: false } });
        const id = await createBackup('error');
        expect(await notifier.notifyBackupFailed(id)).toBe(false);
        expect(sent).toHaveLength(0);
    });

    it('sends nothing while the SMTP block is incomplete', async () => {
        await prisma.settings.update({ where: { id: 1 }, data: { notifyTo: null } });
        const id = await createBackup('error');
        expect(await notifier.notifyBackupFailed(id)).toBe(false);
        expect(sent).toHaveLength(0);
    });

    it('ignores a backup that did not fail or no longer exists', async () => {
        const id = await createBackup('success');
        expect(await notifier.notifyBackupFailed(id)).toBe(false);
        expect(await notifier.notifyBackupFailed(id + 1000)).toBe(false);
        expect(sent).toHaveLength(0);
    });
});

describe('notifyInterrupted', () => {
    it('sends one mail listing the domains, nothing for an empty sweep', async () => {
        expect(await notifier.notifyInterrupted([])).toBe(false);
        expect(await notifier.notifyInterrupted(['a.test', 'b.test'])).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0]!.mail.subject).toBe('[Reposite] 2 backups interrupted by a restart');
        expect(sent[0]!.mail.text).toContain('- b.test');
    });
});

describe('start', () => {
    it('reacts to the done event of a failed backup, once even when called twice', async () => {
        notifier.start();
        notifier.start();
        const failed = await createBackup('error');
        const ok = await createBackup('success');

        queue.events.emit('done', { jobId: ok, status: 'success' });
        queue.events.emit('done', { jobId: failed, status: 'error' });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]!.mail.subject).toBe('[Reposite] Backup failed: site.test');

        // A second tick with nothing new: the listener is registered once.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(sent).toHaveLength(1);
    });
});
