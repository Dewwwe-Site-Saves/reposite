import { describe, expect, it } from 'vitest';
import { LOG_TAIL_LINES, failureMail, interruptedMail, testMail } from './templates';

const base = {
    domain: 'site.test',
    siteId: 7,
    kind: 'backup' as const,
    jobId: 42,
    triggerType: 'scheduled',
    startedAt: new Date('2026-09-06T00:00:00Z'),
    finishedAt: new Date('2026-09-06T00:01:30Z'),
    durationMs: 90_000,
    errorMessage: 'FTP: 530 Login incorrect',
    log: null,
    appUrl: null,
    timeZone: 'UTC',
};

describe('failureMail', () => {
    it('names the site in the subject and carries the error and the dates', () => {
        const mail = failureMail(base);
        expect(mail.subject).toBe('[Reposite] Backup failed: site.test');
        expect(mail.text).toContain('Backup #42 of site.test failed.');
        expect(mail.text).toContain('Trigger: scheduled');
        expect(mail.text).toContain('Started: 6 Sept 2026, 00:00');
        expect(mail.text).toContain('Duration: 1m 30s');
        expect(mail.text).toContain('Error: FTP: 530 Login incorrect');
        expect(mail.html).toContain('<strong>site.test</strong>');
        expect(mail.html).toContain('FTP: 530 Login incorrect');
    });

    it('links the history of the site only when the app URL is known', () => {
        expect(failureMail(base).text).not.toContain('History:');
        expect(failureMail(base).html).not.toContain('href');

        const mail = failureMail({ ...base, appUrl: 'https://backups.example.com' });
        expect(mail.text).toContain('History: https://backups.example.com/history?siteId=7');
        expect(mail.html).toContain('href="https://backups.example.com/history?siteId=7"');
    });

    it('keeps only the tail of the log, without blank lines', () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
        const mail = failureMail({ ...base, log: lines.join('\n') + '\n\n' });
        expect(mail.text).toContain(`Last ${LOG_TAIL_LINES} log lines:`);
        expect(mail.text).not.toContain('line 20\n');
        expect(mail.text).toContain('line 21\n');
        expect(mail.text.trimEnd().endsWith('line 50')).toBe(true);
    });

    it('escapes HTML in the values', () => {
        const mail = failureMail({ ...base, errorMessage: '<script>alert(1)</script> & co' });
        expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
        expect(mail.html).not.toContain('<script>');
    });

    it('shows placeholders for missing dates, duration and error', () => {
        const mail = failureMail({
            ...base,
            startedAt: null,
            finishedAt: null,
            durationMs: null,
            errorMessage: null,
        });
        expect(mail.text).toContain('Started: -');
        expect(mail.text).toContain('Duration: -');
        expect(mail.text).toContain('Error: Unknown error');
    });
});

describe('interruptedMail', () => {
    it('lists the domains and agrees the subject in number', () => {
        const one = interruptedMail({ domains: ['a.test'], appUrl: null });
        expect(one.subject).toBe('[Reposite] 1 backup interrupted by a restart');
        expect(one.text).toContain('- a.test');

        const two = interruptedMail({ domains: ['a.test', 'b.test'], appUrl: 'https://x.test' });
        expect(two.subject).toBe('[Reposite] 2 backups interrupted by a restart');
        expect(two.text).toContain('History: https://x.test/history');
        expect(two.html).toContain('<li>b.test</li>');
    });
});

describe('testMail', () => {
    it('mentions the instance when the app URL is known', () => {
        expect(testMail({ appUrl: null }).text).not.toContain('Instance:');
        expect(testMail({ appUrl: 'https://x.test' }).text).toContain('Instance: https://x.test');
    });
});
