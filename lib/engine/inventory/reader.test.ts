import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunCancelledError } from '../cancel';
import { createLogger } from '../logger';
import { createLocalReader, readInventory } from './index';

let root: string;

function write(relPath: string, content: string | Buffer): void {
    const filePath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reposite-inventory-'));
    write('wp-includes/version.php', "<?php\n$wp_version = '6.4.3';\n");
    write('wp-content/plugins/forms/forms.php', '<?php\n/* Plugin Name: Forms\nVersion: 2.1.0 */');
    write('wp-content/themes/classic/style.css', '/*\nTheme Name: Classic\nVersion: 1.4\n*/');
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('createLocalReader', () => {
    it('reads the same inventory from a local copy of the site', async () => {
        const log = createLogger('[site.test]');

        const inventory = await readInventory(createLocalReader(root, { log }), log, 'the clone');

        expect(inventory).toEqual({
            cms: 'wordpress',
            version: '6.4.3',
            components: [
                { type: 'plugin', slug: 'forms', name: 'Forms', version: '2.1.0' },
                { type: 'theme', slug: 'classic', name: 'Classic', version: '1.4' },
            ],
        });
        expect(log.text()).toContain('WordPress detected in the clone');
    });

    it('does not load an oversized file', async () => {
        write('wp-content/themes/classic/style.css', Buffer.alloc(1024 * 1024 + 1, 'a'));
        const log = createLogger('[site.test]');

        const inventory = await readInventory(createLocalReader(root, { log }), log, 'the clone');

        expect(inventory.components).toContainEqual({
            type: 'theme',
            slug: 'classic',
            name: 'classic',
            version: null,
        });
        expect(log.text()).toContain('[warn]');
    });

    it('throws when a file the CMS needs is missing', async () => {
        fs.rmSync(path.join(root, 'wp-includes/version.php'));
        const log = createLogger('[site.test]');

        await expect(
            readInventory(createLocalReader(root, { log }), log, 'the clone'),
        ).rejects.toThrow(/ENOENT/);
    });

    it('stops on an aborted signal', async () => {
        const controller = new AbortController();
        controller.abort();
        const log = createLogger('[site.test]');
        const reader = createLocalReader(root, { log, signal: controller.signal });

        await expect(readInventory(reader, log, 'the clone')).rejects.toBeInstanceOf(
            RunCancelledError,
        );
    });
});
