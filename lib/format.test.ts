import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';

describe('formatRelative', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

    it('uses the largest unit that fits', () => {
        expect(formatRelative(ago(59), now)).toBe('just now');
        expect(formatRelative(ago(60), now)).toBe('1 minute ago');
        expect(formatRelative(ago(59 * 60), now)).toBe('59 minutes ago');
        expect(formatRelative(ago(14 * 3600), now)).toBe('14 hours ago');
        expect(formatRelative(ago(9 * 86_400), now)).toBe('9 days ago');
        expect(formatRelative(ago(45 * 86_400), now)).toBe('1 month ago');
        expect(formatRelative(ago(800 * 86_400), now)).toBe('2 years ago');
    });

    it('never speaks of the future', () => {
        expect(formatRelative(ago(-120), now)).toBe('just now');
    });
});
