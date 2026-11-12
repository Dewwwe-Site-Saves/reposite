import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteConfig } from '../types';

// Remote clients are replaced by the in-memory server.
const { remoteRef } = vi.hoisted(() => ({ remoteRef: { current: null as unknown } }));
vi.mock('../remote', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../remote')>();
    return {
        ...actual,
        createRemoteFactory: () => (remoteRef.current as { factory(): unknown }).factory(),
    };
});

const { FakeRemote } = await import('../testing/fake-remote');
const { runInventory } = await import('./index');

const site: SiteConfig = {
    domain: 'site.test',
    repo: 'site-test',
    repoUrl: 'https://github.com/example/site-test.git',
    protocol: 'ftp',
    host: 'ftp.site.test',
    port: 21,
    username: 'user',
    password: 'secret',
    webRootPath: 'www',
    spListItemId: null,
    inventoryEnabled: true,
};

const PLUGINS = '/www/wp-content/plugins';
const THEMES = '/www/wp-content/themes';

function pluginHeader(name: string, version: string): string {
    return `<?php\n/**\n * Plugin Name: ${name}\n * Version: ${version}\n */\n`;
}

let remote: InstanceType<typeof FakeRemote>;

/** A WordPress 6.4.3 with one conventional plugin and one theme. */
function seedWordPress(): void {
    remote.put('/www/index.php', '<?php');
    remote.put('/www/wp-includes/version.php', "<?php\n$wp_version = '6.4.3';\n");
    remote.put(`${PLUGINS}/index.php`, '<?php // Silence is golden.');
    remote.put(`${PLUGINS}/forms/forms.php`, pluginHeader('Forms', '2.1.0'));
    remote.put(`${PLUGINS}/forms/includes/loader.php`, '<?php');
    remote.put(`${THEMES}/index.php`, '<?php // Silence is golden.');
    remote.put(`${THEMES}/classic/style.css`, '/*\nTheme Name: Classic\nVersion: 1.4\n*/');
}

beforeEach(() => {
    remote = new FakeRemote();
    remoteRef.current = remote;
});

describe('runInventory', () => {
    it('reads the core version, the plugins and the themes of a WordPress site', async () => {
        seedWordPress();

        const result = await runInventory(site);

        expect(result.status).toBe('success');
        expect(result.errorMessage).toBeNull();
        expect(result.inventory).toEqual({
            cms: 'wordpress',
            version: '6.4.3',
            components: [
                { type: 'plugin', slug: 'forms', name: 'Forms', version: '2.1.0' },
                { type: 'theme', slug: 'classic', name: 'Classic', version: '1.4' },
            ],
        });
        expect(result.log).toContain('WordPress 6.4.3, 1 plugin, 1 theme');
    });

    it('reads one file per conventional plugin and never the stock index.php', async () => {
        seedWordPress();
        remote.put(`${PLUGINS}/forms/admin.php`, '<?php');

        await runInventory(site);

        expect(remote.reads).toEqual([
            '/www/wp-includes/version.php',
            `${PLUGINS}/forms/forms.php`,
            `${THEMES}/classic/style.css`,
        ]);
    });

    it('finds a main file that is not named after its directory', async () => {
        seedWordPress();
        remote.put(`${PLUGINS}/seo-pack/functions.php`, '<?php // helpers');
        remote.put(`${PLUGINS}/seo-pack/wp-seo.php`, pluginHeader('SEO Pack', '21.5'));

        const { inventory } = await runInventory(site);

        expect(inventory?.components).toContainEqual({
            type: 'plugin',
            slug: 'seo-pack',
            name: 'SEO Pack',
            version: '21.5',
        });
    });

    it('reports single-file plugins and must-use plugins, with or without a header', async () => {
        seedWordPress();
        remote.put(`${PLUGINS}/hello.php`, pluginHeader('Hello', '1.7.2'));
        remote.put('/www/wp-content/mu-plugins/loader.php', '<?php // no header');
        remote.put('/www/wp-content/mu-plugins/cache.php', pluginHeader('Cache Drop-in', '3.0'));

        const { inventory } = await runInventory(site);

        expect(inventory?.components).toEqual([
            { type: 'plugin', slug: 'forms', name: 'Forms', version: '2.1.0' },
            { type: 'plugin', slug: 'hello', name: 'Hello', version: '1.7.2' },
            { type: 'mu-plugin', slug: 'cache', name: 'Cache Drop-in', version: '3.0' },
            { type: 'mu-plugin', slug: 'loader', name: 'loader', version: null },
            { type: 'theme', slug: 'classic', name: 'Classic', version: '1.4' },
        ]);
    });

    it('leaves out directories that are not components', async () => {
        seedWordPress();
        remote.put(`${PLUGINS}/__MACOSX/forms/._forms.php`, 'resource fork');
        remote.put(`${PLUGINS}/assets-only/logo.png`, 'png');
        remote.put(`${THEMES}/backup-2024/readme.txt`, 'not a theme');

        const { inventory } = await runInventory(site);

        expect(inventory?.components.map((component) => component.slug)).toEqual([
            'forms',
            'classic',
        ]);
    });

    it('reads the core version, the modules and the themes of a PrestaShop site', async () => {
        remote.put('/www/index.php', '<?php');
        for (const dir of ['classes', 'config']) remote.put(`/www/${dir}/index.php`, '<?php');
        remote.put(
            '/www/app/AppKernel.php',
            [
                '<?php',
                'class AppKernel extends Kernel {',
                '    const VERSION = Version::VERSION;',
                '    const MAJOR_VERSION_STRING = Version::MAJOR_VERSION_STRING;',
                '    const MAJOR_VERSION = 8;',
                '    const MINOR_VERSION = 2;',
                '    const RELEASE_VERSION = 3;',
                '}',
            ].join('\n'),
        );
        remote.put('/www/modules/index.php', '<?php');
        remote.put(
            '/www/modules/ps_banner/ps_banner.php',
            [
                '<?php',
                ' * versions in the future.',
                "        $this->version = '2.1.2';",
                "        $this->displayName = $this->trans('Banner', [], 'Modules.Banner.Admin');",
                "        $this->ps_versions_compliancy = ['min' => '1.7.1.0', 'max' => _PS_VERSION_];",
            ].join('\n'),
        );
        remote.put('/www/modules/ps_banner/config.xml', '<module/>');
        remote.put('/www/modules/__MACOSX/ps_banner/._ps_banner.php', 'resource fork');
        remote.put('/www/themes/index.php', '<?php');
        remote.put('/www/themes/core.js', '// not a theme');
        remote.put('/www/themes/_libraries/readme.txt', 'not a theme');
        remote.put(
            '/www/themes/classic/config/theme.yml',
            'name: classic\ndisplay_name: Classic\nversion: 2.2.0\nauthor:\n  name: "Someone"\n',
        );

        const result = await runInventory(site);

        expect(result.errorMessage).toBeNull();
        expect(result.inventory).toEqual({
            cms: 'prestashop',
            version: '8.2.3',
            components: [
                { type: 'module', slug: 'ps_banner', name: 'Banner', version: '2.1.2' },
                { type: 'theme', slug: 'classic', name: 'Classic', version: '2.2.0' },
            ],
        });
        expect(result.log).toContain('PrestaShop 8.2.3, 1 module, 1 theme');
        // One read per module and per theme, plus the kernel.
        expect(remote.reads).toEqual([
            '/www/app/AppKernel.php',
            '/www/modules/ps_banner/ps_banner.php',
            '/www/themes/classic/config/theme.yml',
        ]);
    });

    it('fails when the web root holds no supported CMS', async () => {
        remote.put('/www/index.html', '<html>');

        const result = await runInventory(site);

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('No supported CMS found in /www');
        expect(result.inventory).toBeNull();
    });

    it('fails when the content directory is not where WordPress puts it', async () => {
        remote.put('/www/wp-includes/version.php', "<?php\n$wp_version = '6.4.3';\n");

        const result = await runInventory(site);

        expect(result.status).toBe('error');
        expect(result.errorMessage).toMatch(/^No wp-content directory at the web root/);
    });

    it('stores nothing when one file cannot be read: an inventory is never partial', async () => {
        seedWordPress();
        remote.undownloadable.add(`${PLUGINS}/forms/forms.php`);

        const result = await runInventory(site);

        expect(result.status).toBe('error');
        expect(result.errorMessage).toBe('Transfer failed');
        expect(result.inventory).toBeNull();
    });

    it('fails on a directory that cannot be listed', async () => {
        seedWordPress();
        remote.unlistable.add(THEMES);

        const result = await runInventory(site);

        expect(result.status).toBe('error');
        expect(result.inventory).toBeNull();
    });

    it('does not download a file a listing shows to be oversized', async () => {
        seedWordPress();
        remote.put(`${THEMES}/classic/style.css`, Buffer.alloc(1024 * 1024 + 1, 'a'));

        const result = await runInventory(site);

        expect(remote.reads).not.toContain(`${THEMES}/classic/style.css`);
        expect(result.inventory?.components).toContainEqual({
            type: 'theme',
            slug: 'classic',
            name: 'classic',
            version: null,
        });
        expect(result.log).toContain('[warn]');
    });

    it('ends as cancelled when the signal is already aborted', async () => {
        seedWordPress();
        const controller = new AbortController();
        controller.abort();

        const result = await runInventory(site, { signal: controller.signal });

        expect(result.status).toBe('cancelled');
        expect(result.errorMessage).toBe('Cancelled by user');
        expect(result.inventory).toBeNull();
    });

    it('forwards every log entry to the listener', async () => {
        seedWordPress();
        const messages: string[] = [];

        await runInventory(site, { onLog: (entry) => messages.push(entry.msg) });

        expect(messages[0]).toBe('[site.test] WordPress detected in /www');
        expect(messages.at(-1)).toMatch(/^\[site\.test\] Inventory SUCCESS in 0m \d+s$/);
    });
});
