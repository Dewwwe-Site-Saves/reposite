import type { LogEntry, LogLevel, Logger } from './types';

export interface BufferedLogger extends Logger {
    readonly entries: readonly LogEntry[];
    /** One line per entry, see `formatLog`. */
    text(): string;
}

/** One line per entry: `<time> [<level>] <message>`. The format stored in `Job.log`. */
export function formatLog(entries: readonly LogEntry[]): string {
    return entries.map((e) => `${e.time} [${e.level}] ${e.msg}`).join('\n');
}

const LOG_LINE = /^(\S+) \[(info|warn|error)\] (.*)$/;

/** Inverse of `formatLog`. Lines that do not match keep their text as an `info` entry. */
export function parseLog(text: string): LogEntry[] {
    return text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
            const match = LOG_LINE.exec(line);
            return match
                ? { time: match[1], level: match[2] as LogLevel, msg: match[3] }
                : { time: '', level: 'info', msg: line };
        });
}

/**
 * Logger that keeps every entry in memory and forwards it to an optional listener (the
 * queue streams entries to SSE clients). Nothing is written to the console: the engine
 * is a library, the caller decides what to do with the output.
 */
export function createLogger(prefix: string, onLog?: (entry: LogEntry) => void): BufferedLogger {
    const entries: LogEntry[] = [];

    function write(level: LogLevel, msg: string): void {
        const entry: LogEntry = { time: new Date().toISOString(), level, msg: `${prefix} ${msg}` };
        entries.push(entry);
        onLog?.(entry);
    }

    return {
        entries,
        info: (msg) => write('info', msg),
        warn: (msg) => write('warn', msg),
        error: (msg) => write('error', msg),
        text: () => formatLog(entries),
    };
}
