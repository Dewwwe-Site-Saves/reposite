import cronstrue from 'cronstrue';
import { createTask } from 'node-cron';

/** What the schedule summary bar shows: the rule in plain English and when it fires next. */
export interface CronSummary {
    /** The expression in prose, or the expression itself when it cannot be described. */
    rule: string;
    /** The next firing, formatted in the scheduler's timezone. Null when it never fires again. */
    next: string | null;
}

/** The zone cron tasks run in, read the same way `lib/jobs/scheduler.ts` reads it. */
function timezone(): string | undefined {
    return process.env.TZ || undefined;
}

export function describeCron(expression: string): CronSummary {
    return { rule: cronRule(expression), next: formatDate(nextRun(expression)) };
}

function cronRule(expression: string): string {
    try {
        return cronstrue.toString(expression, { verbose: false, use24HourTimeFormat: true });
    } catch {
        return expression;
    }
}

/**
 * The next firing of an expression. The task is created but never started, and destroyed right
 * away: `node-cron` keeps a global registry, and the scheduler must stay the only thing in it.
 *
 * `getNextRuns(1)` rather than `getNextRun()`: the latter reads the timer of a running task and so
 * answers null on one that was never started.
 */
function nextRun(expression: string): Date | null {
    try {
        const task = createTask(expression, () => {}, { timezone: timezone() });
        const [next] = task.getNextRuns(1);
        void task.destroy();
        return next ?? null;
    } catch {
        return null;
    }
}

function formatDate(date: Date | null): string | null {
    if (!date) return null;
    return new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: timezone(),
        timeZoneName: 'short',
    }).format(date);
}
