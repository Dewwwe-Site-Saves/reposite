import { describe, expect, it } from 'vitest';
import { describeCron } from './cron';

describe('describeCron', () => {
    it('reads an expression in prose and finds its next run', () => {
        const summary = describeCron('0 2 1,15 * *');
        expect(summary.rule).toContain('02:00');
        expect(summary.rule).toContain('1');
        // Regression: `getNextRun()` answers null on a task that was never started.
        expect(summary.next).toEqual(expect.any(String));
        expect(summary.next).toMatch(/\d{4}/);
    });

    it('uses a 24 hour clock, like the rest of the app', () => {
        expect(describeCron('30 15 * * *').rule).toContain('15:30');
    });

    it('falls back to the expression itself when it cannot be read', () => {
        const summary = describeCron('not a cron expression');
        expect(summary.rule).toBe('not a cron expression');
        expect(summary.next).toBeNull();
    });
});
