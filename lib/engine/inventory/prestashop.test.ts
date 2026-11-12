import { describe, expect, it } from 'vitest';
import { parseCoreVersion, parseModuleName, parseModuleVersion, yamlField } from './prestashop';

describe('parseCoreVersion', () => {
    it('spells the version from the three integers of an 8.x kernel', () => {
        const kernel = [
            '    const VERSION = Version::VERSION;',
            '    const MAJOR_VERSION_STRING = Version::MAJOR_VERSION_STRING;',
            '    const MAJOR_VERSION = 8;',
            '    const MINOR_VERSION = 2;',
            '    const RELEASE_VERSION = 3;',
        ].join('\n');
        expect(parseCoreVersion(kernel)).toBe('8.2.3');
    });

    it('prefers a literal version, as 1.7 wrote it', () => {
        const kernel = [
            "    const VERSION = '1.7.8.10';",
            "    const MAJOR_VERSION_STRING = '1.7';",
            '    const MAJOR_VERSION = 17;',
            '    const MINOR_VERSION = 8;',
            '    const RELEASE_VERSION = 10;',
        ].join('\n');
        expect(parseCoreVersion(kernel)).toBe('1.7.8.10');
    });

    it('returns null when a constant is missing', () => {
        expect(parseCoreVersion('const MAJOR_VERSION = 8;\nconst MINOR_VERSION = 2;')).toBeNull();
    });
});

describe('parseModuleVersion', () => {
    it('reads the version set in the constructor', () => {
        expect(parseModuleVersion("        $this->version = '2.1.2';")).toBe('2.1.2');
        expect(parseModuleVersion('$this->version="1.0.0";')).toBe('1.0.0');
    });

    it('is not fooled by the compliancy range', () => {
        expect(
            parseModuleVersion("$this->ps_versions_compliancy = ['min' => '1.7.1.0'];"),
        ).toBeNull();
    });
});

describe('parseModuleName', () => {
    it('reads the name through either translation call, or bare', () => {
        expect(
            parseModuleName(
                "$this->displayName = $this->trans('Banner', [], 'Modules.Banner.Admin');",
            ),
        ).toBe('Banner');
        expect(parseModuleName('$this->displayName = $this->l("Wish list");')).toBe('Wish list');
        expect(parseModuleName("$this->displayName = 'Plain name';")).toBe('Plain name');
    });

    it('unescapes a quote inside the name', () => {
        expect(parseModuleName("$this->displayName = $this->l('Today\\'s deals');")).toBe(
            "Today's deals",
        );
    });

    it('returns null when the name is not a literal', () => {
        expect(parseModuleName('$this->displayName = $name;')).toBeNull();
        expect(parseModuleName('<?php // nothing')).toBeNull();
    });
});

describe('yamlField', () => {
    const yaml =
        'name: classic\ndisplay_name: "Classic"\nversion: 2.2.0 # stable\nauthor:\n  name: "Someone"\n';

    it('reads top-level scalars, quoted or not, without their comment', () => {
        expect(yamlField(yaml, 'name')).toBe('classic');
        expect(yamlField(yaml, 'display_name')).toBe('Classic');
        expect(yamlField(yaml, 'version')).toBe('2.2.0');
    });

    it('ignores nested keys and empty values', () => {
        expect(yamlField('author:\n  name: "Someone"\n', 'name')).toBeNull();
        expect(yamlField('author:\n  name: x\n', 'author')).toBeNull();
        expect(yamlField('version: ~\n', 'version')).toBeNull();
    });

    it('handles CRLF line endings', () => {
        expect(yamlField('name: classic\r\nversion: 2.2.0\r\n', 'version')).toBe('2.2.0');
    });
});
