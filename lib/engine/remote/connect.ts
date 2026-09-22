import { BackupCancelledError, errorMessage, isCancellation, throwIfAborted } from '../cancel';
import type { Logger } from '../types';
import type { RemoteClient, RemoteClientFactory } from './client';

/** Waits before the second and the third attempt. Shared hosts drop a fresh connection now and then (connection cap per address, anti-flood rules): a run must not fail on one refused login. */
export const CONNECT_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000];

export interface ConnectOptions {
    log: Logger;
    signal?: AbortSignal;
    /** Waits between attempts, one more attempt than delays. Defaults to `CONNECT_RETRY_DELAYS_MS`. */
    retryDelaysMs?: readonly number[];
}

/** Opens one connection, retrying after each delay of `retryDelaysMs`. A cancellation is never retried. */
export async function openClient(
    factory: RemoteClientFactory,
    options: ConnectOptions,
): Promise<RemoteClient> {
    const { log, signal } = options;
    const delays = options.retryDelaysMs ?? CONNECT_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
        throwIfAborted(signal);
        try {
            return await factory.create();
        } catch (error) {
            if (isCancellation(error) || attempt >= delays.length) throw error;
            const delay = delays[attempt];
            log.warn(
                `Connection attempt ${attempt + 1}/${delays.length + 1} failed: ${errorMessage(error)}; retrying in ${Math.round(delay / 1000)} s`,
            );
            await sleep(delay, signal);
        }
    }
}

/** Resolves after `ms`, rejects at once with the cancellation error when the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new BackupCancelledError());
        const onAbort = () => {
            clearTimeout(timer);
            reject(new BackupCancelledError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
