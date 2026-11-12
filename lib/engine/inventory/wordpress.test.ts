import { describe, expect, it } from 'vitest';
import { headerField, parseCoreVersion } from './wordpress';

describe('parseCoreVersion', () => {
    it('reads $wp_version with either quote style', () => {
        expect(parseCoreVersion("<?php\n$wp_version = '6.4.3';\n$wp_db_version = 56657;")).toBe(
            '6.4.3',
        );
        expect(parseCoreVersion('$wp_version="7.3-RC1";')).toBe('7.3-RC1');
    });

    it('returns null when the file carries no version', () => {
        expect(parseCoreVersion('<?php // nothing here')).toBeNull();
    });
});

describe('headerField', () => {
    const header = [
        '<?php',
        '/**',
        ' * Plugin Name: Forms & Co',
        ' * Plugin URI:  https://example.com/forms',
        ' * Version:     2.1.0',
        ' * Requires PHP: 7.4',
        ' */',
    ].join('\n');

    it('reads a field whatever decorates the line', () => {
        expect(headerField(header, 'Plugin Name')).toBe('Forms & Co');
        expect(headerField(header, 'Version')).toBe('2.1.0');
        expect(headerField('# Plugin Name: Hash', 'Plugin Name')).toBe('Hash');
        expect(headerField('<?php // Plugin Name: Inline', 'Plugin Name')).toBe('Inline');
    });

    it('matches the field name case-insensitively, like WordPress', () => {
        expect(headerField('/*\nplugin name: lower\n*/', 'Plugin Name')).toBe('lower');
    });

    it('trims a comment terminator sharing the line', () => {
        expect(headerField('/* Plugin Name: One Liner */', 'Plugin Name')).toBe('One Liner');
        expect(headerField('<?php /* Version: 1.0 */ ?>', 'Version')).toBe('1.0');
    });

    it('handles CRLF and bare CR line endings', () => {
        expect(headerField('/*\r\nTheme Name: Classic\r\nVersion: 1.4\r\n*/', 'Version')).toBe(
            '1.4',
        );
        expect(headerField('/*\rTheme Name: Old Mac\r*/', 'Theme Name')).toBe('Old Mac');
    });

    it('does not take a longer field for a shorter one', () => {
        expect(headerField(' * Requires PHP Version: 8.1', 'Version')).toBeNull();
    });

    it('returns null for an absent or empty field', () => {
        expect(headerField(header, 'Theme Name')).toBeNull();
        expect(headerField(' * Version:   ', 'Version')).toBeNull();
    });

    it('ignores anything past the first 8 KB', () => {
        expect(headerField(`${' '.repeat(8192)}\nVersion: 9.9`, 'Version')).toBeNull();
    });
});
