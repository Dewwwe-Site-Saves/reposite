import { describe, expect, it, vi } from 'vitest';
import { BackupCancelledError } from '../cancel';
import { createLogger } from '../logger';
import type { RemoteClient, RemoteClientFactory } from './client';
import { openClient } from './connect';

const client = {} as RemoteClient;

function factoryFailing(times: number, message = 'Server sent FIN packet unexpectedly') {
    const create = vi.fn(async () => {
        if (create.mock.calls.length <= times) throw new Error(message);
        return client;
    });
    return { poolSize: 1, create } satisfies RemoteClientFactory;
}

describe('openClient', () => {
    it('returns the first connection that opens', async () => {
        const log = createLogger('[test]');
        const factory = factoryFailing(2);
        await expect(openClient(factory, { log, retryDelaysMs: [1, 1] })).resolves.toBe(client);
        expect(factory.create).toHaveBeenCalledTimes(3);
        expect(log.entries.filter((e) => e.level === 'warn').map((e) => e.msg)).toEqual([
            '[test] Connection attempt 1/3 failed: Server sent FIN packet unexpectedly; retrying in 0 s',
            '[test] Connection attempt 2/3 failed: Server sent FIN packet unexpectedly; retrying in 0 s',
        ]);
    });

    it('gives up with the last error once the delays are spent', async () => {
        const factory = factoryFailing(3, 'Login incorrect');
        await expect(
            openClient(factory, { log: createLogger('[test]'), retryDelaysMs: [1, 1] }),
        ).rejects.toThrow('Login incorrect');
        expect(factory.create).toHaveBeenCalledTimes(3);
    });

    it('never retries a cancellation', async () => {
        const create = vi.fn(async () => {
            throw new BackupCancelledError();
        });
        await expect(
            openClient(
                { poolSize: 1, create },
                { log: createLogger('[test]'), retryDelaysMs: [1] },
            ),
        ).rejects.toBeInstanceOf(BackupCancelledError);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('stops waiting as soon as the run is cancelled', async () => {
        const controller = new AbortController();
        const factory = factoryFailing(1);
        const pending = openClient(factory, {
            log: createLogger('[test]'),
            signal: controller.signal,
            retryDelaysMs: [60_000],
        });
        await vi.waitFor(() => expect(factory.create).toHaveBeenCalledTimes(1));
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(BackupCancelledError);
        expect(factory.create).toHaveBeenCalledTimes(1);
    });
});
