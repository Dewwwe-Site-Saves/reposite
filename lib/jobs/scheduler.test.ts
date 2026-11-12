import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteSummary } from '../db';

// node-cron, the database reads and the queue are all replaced: the scheduler only wires them.
const { cron, db, queue } = vi.hoisted(() => ({
    cron: {
        schedule: vi.fn(),
        tasks: [] as {
            expression: string;
            fn: () => unknown;
            options: unknown;
            destroy: () => void;
        }[],
    },
    db: {
        sites: [] as unknown[],
        defaultCron: '0 3 * * *',
        defaultInventoryCron: '0 4 * * *',
    },
    queue: {
        enqueue: vi.fn(),
    },
}));

vi.mock('node-cron', () => ({
    schedule: cron.schedule,
}));

vi.mock('../db', () => ({
    getSettings: async () => ({
        defaultCron: db.defaultCron,
        defaultInventoryCron: db.defaultInventoryCron,
    }),
    listSites: async () => db.sites,
}));

vi.mock('./queue', () => ({
    enqueue: queue.enqueue,
    JobConflictError: class JobConflictError extends Error {},
}));

const scheduler = await import('./scheduler');
const { JobConflictError } = await import('./queue');

function site(id: number, overrides: Partial<SiteSummary> = {}): SiteSummary {
    return {
        id,
        domain: `site${id}.example.com`,
        repo: `site${id}`,
        repoUrl: `https://github.com/acme/site${id}.git`,
        protocol: 'ftp',
        host: 'ftp.example.com',
        port: 21,
        username: 'user',
        webRootPath: 'www',
        spListItemId: null,
        cronSchedule: null,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        cms: null,
        cmsVersion: null,
        inventoryAt: null,
        inventoryEnabled: false,
        inventoryCronSchedule: null,
        ...overrides,
    };
}

beforeEach(() => {
    cron.tasks = [];
    cron.schedule.mockImplementation((expression: string, fn: () => unknown, options: unknown) => {
        const task = { expression, fn, options, destroy: vi.fn() };
        cron.tasks.push(task);
        return task;
    });
    queue.enqueue.mockReset();
    queue.enqueue.mockResolvedValue(1);
    db.sites = [];
    db.defaultCron = '0 3 * * *';
    vi.stubEnv('TZ', 'Europe/Paris');
});

afterEach(async () => {
    await scheduler.stop();
    vi.unstubAllEnvs();
});

describe('reload', () => {
    it('schedules every enabled site with its cron or the default, in the TZ timezone', async () => {
        db.sites = [
            site(1),
            site(2, { cronSchedule: '30 4 * * 1' }),
            site(3, { enabled: false, cronSchedule: '0 0 * * *' }),
        ];
        await scheduler.reload();

        expect(cron.tasks.map((t) => [t.expression, t.options])).toEqual([
            ['0 3 * * *', { timezone: 'Europe/Paris' }],
            ['30 4 * * 1', { timezone: 'Europe/Paris' }],
        ]);
        expect(scheduler.scheduledSiteIds('backup')).toEqual([1, 2]);
    });

    it('schedules the inventory of a site on its own switch and cron', async () => {
        db.sites = [
            site(1, { inventoryEnabled: true }),
            site(2, {
                enabled: false,
                inventoryEnabled: true,
                inventoryCronSchedule: '15 5 * * *',
            }),
            site(3),
        ];
        await scheduler.reload();

        expect(cron.tasks.map((t) => t.expression)).toEqual([
            '0 3 * * *',
            '0 4 * * *',
            '15 5 * * *',
            '0 3 * * *',
        ]);
        expect(scheduler.scheduledSiteIds('backup')).toEqual([1, 3]);
        expect(scheduler.scheduledSiteIds('inventory')).toEqual([1, 2]);
    });

    it('leaves the timezone to node-cron when TZ is unset', async () => {
        vi.stubEnv('TZ', '');
        db.sites = [site(1)];
        await scheduler.reload();
        expect(cron.tasks[0].options).toEqual({ timezone: undefined });
    });

    it('destroys the previous tasks before scheduling again', async () => {
        db.sites = [site(1), site(2)];
        await scheduler.reload();
        const [first, second] = cron.tasks;

        db.sites = [site(2, { cronSchedule: '0 1 * * *' })];
        await scheduler.reload();

        expect(first.destroy).toHaveBeenCalledOnce();
        expect(second.destroy).toHaveBeenCalledOnce();
        expect(scheduler.scheduledSiteIds('backup')).toEqual([2]);
        expect(cron.tasks.at(-1)?.expression).toBe('0 1 * * *');
    });

    it('serializes concurrent reloads', async () => {
        db.sites = [site(1)];
        await Promise.all([scheduler.reload(), scheduler.reload()]);
        expect(scheduler.scheduledSiteIds('backup')).toEqual([1]);
        expect(cron.tasks).toHaveLength(2);
        expect(cron.tasks[0].destroy).toHaveBeenCalledOnce();
        expect(cron.tasks[1].destroy).not.toHaveBeenCalled();
    });

    it('keeps the other sites when one expression is rejected by node-cron', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        cron.schedule.mockImplementationOnce(() => {
            throw new Error('bad expression');
        });
        db.sites = [site(1, { cronSchedule: 'nope' }), site(2)];
        await scheduler.reload();

        expect(scheduler.scheduledSiteIds('backup')).toEqual([2]);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('site1.example.com'));
        error.mockRestore();
    });
});

describe('task', () => {
    it('enqueues a scheduled backup for its site', async () => {
        db.sites = [site(7)];
        await scheduler.reload();
        await cron.tasks[0].fn();
        expect(queue.enqueue).toHaveBeenCalledWith(7, {
            kind: 'backup',
            triggerType: 'scheduled',
        });
    });

    it('enqueues a scheduled inventory on its own task', async () => {
        db.sites = [site(7, { enabled: false, inventoryEnabled: true })];
        await scheduler.reload();
        await cron.tasks[0].fn();
        expect(queue.enqueue).toHaveBeenCalledWith(7, {
            kind: 'inventory',
            triggerType: 'scheduled',
        });
    });

    it('skips the run when the site already has an active job', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        queue.enqueue.mockRejectedValue(new JobConflictError(7));
        db.sites = [site(7)];
        await scheduler.reload();
        await expect(cron.tasks[0].fn()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('site7.example.com'));
        warn.mockRestore();
    });
});

describe('stop', () => {
    it('destroys every task', async () => {
        db.sites = [site(1), site(2)];
        await scheduler.reload();
        await scheduler.stop();
        expect(scheduler.scheduledSiteIds('backup')).toEqual([]);
        expect(
            cron.tasks.every(
                (t) => (t.destroy as ReturnType<typeof vi.fn>).mock.calls.length === 1,
            ),
        ).toBe(true);
    });
});
