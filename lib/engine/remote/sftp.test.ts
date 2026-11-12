import { describe, expect, it, vi } from 'vitest';
import type { SiteConfig } from '../types';

// ssh2-sftp-client is replaced by a recorder: the test checks the paths handed to the server.
const { server } = vi.hoisted(() => ({
    server: {
        home: '/home/user',
        calls: [] as [string, string][],
    },
}));

vi.mock('ssh2-sftp-client', () => ({
    default: class {
        connect = async () => {};
        end = async () => {};
        realPath = async (p: string) => (p === '.' ? server.home : p);
        list = async (p: string) => {
            server.calls.push(['list', p]);
            return [
                { name: 'index.php', type: '-', size: 10, modifyTime: 1_000 },
                { name: 'wp-content', type: 'd', size: 0, modifyTime: 0 },
            ];
        };
        fastGet = async (p: string) => {
            server.calls.push(['fastGet', p]);
        };
        get = async (p: string) => {
            server.calls.push(['get', p]);
            return Buffer.from('<?php');
        };
        put = async (_content: Buffer, p: string) => {
            server.calls.push(['put', p]);
        };
        delete = async (p: string) => {
            server.calls.push(['delete', p]);
        };
    },
}));

const { createSftpFactory } = await import('./sftp');

const site: SiteConfig = {
    domain: 'x.example.com',
    repo: 'x',
    repoUrl: 'https://github.com/a/x.git',
    protocol: 'sftp',
    host: 'h',
    port: 22,
    username: 'u',
    password: 'p',
    webRootPath: 'www',
    spListItemId: null,
    inventoryEnabled: false,
};

describe('SftpRemoteClient', () => {
    it('resolves engine paths under the login directory and reports them unchanged', async () => {
        server.home = '/home/user';
        server.calls = [];
        const client = await createSftpFactory(site).create();

        const entries = await client.list('/www');
        await client.download('/www/index.php', '/tmp/index.php');
        await client.upload(Buffer.from('x'), '/www/.token');
        await client.remove('/www/.token');

        expect(server.calls).toEqual([
            ['list', '/home/user/www'],
            ['fastGet', '/home/user/www/index.php'],
            ['put', '/home/user/www/.token'],
            ['delete', '/home/user/www/.token'],
        ]);
        expect(entries.map((e) => [e.path, e.type])).toEqual([
            ['/www/index.php', 'file'],
            ['/www/wp-content', 'dir'],
        ]);
    });

    it('reads a file into memory from under the login directory', async () => {
        server.home = '/home/user';
        server.calls = [];
        const client = await createSftpFactory(site).create();

        const content = await client.read('/www/wp-includes/version.php');

        expect(server.calls).toEqual([['get', '/home/user/www/wp-includes/version.php']]);
        expect(content.toString()).toBe('<?php');
    });

    it('is a no-op for a chrooted account', async () => {
        server.home = '/';
        server.calls = [];
        const client = await createSftpFactory(site).create();
        await client.list('/www');
        expect(server.calls).toEqual([['list', '/www']]);
    });
});
