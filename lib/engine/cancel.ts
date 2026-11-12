/**
 * Cancellation helpers. The queue owns an AbortController per run; the engine checks its
 * signal between steps and between files, and wraps long network calls so they reject as
 * soon as the signal fires.
 */

export class RunCancelledError extends Error {
    constructor() {
        super('Run cancelled');
        this.name = 'RunCancelledError';
    }
}

export function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new RunCancelledError();
}

/** True for our own cancellation error and for Node's AbortError (execFile, fetch). */
export function isCancellation(error: unknown): boolean {
    return (
        error instanceof RunCancelledError ||
        (error instanceof Error && error.name === 'AbortError')
    );
}

/** Rejects as soon as the signal fires, even if the wrapped promise never settles. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(new RunCancelledError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new RunCancelledError());
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
