import type { CmsAdapter, Component, InventoryEntry, InventoryReader } from './types';

const VERSION_FILE = 'wp-includes/version.php';
const CONTENT_DIR = 'wp-content';
/** WordPress looks for a header in the first 8 KB of a file and nowhere else. */
const HEADER_CHARS = 8192;

/**
 * WordPress, read the way WordPress reads itself: the core version from `wp-includes/version.php`, plugins and themes from the comment header of their main file. Whether a plugin is active lives in the database, not in the files, so every installed plugin is reported.
 */
export const wordpress: CmsAdapter = {
    id: 'wordpress',

    detect: (rootEntries) => hasDir(rootEntries, 'wp-includes'),

    async read(reader) {
        const version = parseCoreVersion(await reader.readText(VERSION_FILE));
        if (!version) throw new Error(`No $wp_version found in ${VERSION_FILE}`);

        if (!hasDir(await reader.list(''), CONTENT_DIR)) {
            throw new Error(
                `No ${CONTENT_DIR} directory at the web root (a relocated content directory is not supported)`,
            );
        }
        const content = await reader.list(CONTENT_DIR);
        const components: Component[] = [];
        if (hasDir(content, 'plugins')) components.push(...(await readPlugins(reader)));
        if (hasDir(content, 'mu-plugins')) components.push(...(await readMustUsePlugins(reader)));
        if (hasDir(content, 'themes')) components.push(...(await readThemes(reader)));
        return { version, components };
    },
};

/** `$wp_version = '6.4.3';` */
export function parseCoreVersion(text: string): string | null {
    return /\$wp_version\s*=\s*(['"])([^'"]+)\1/.exec(text)?.[2] ?? null;
}

/**
 * Value of a `Field: value` header line, matched like `get_file_data()` does: in the first 8 KB, any comment decoration in front, a comment terminator or `?>` trimmed off the end. Null when the field is absent or empty.
 */
export function headerField(text: string, field: string): string | null {
    const head = text.slice(0, HEADER_CHARS).replace(/\r/g, '\n');
    const match = new RegExp(`^(?:[ \\t]*<\\?php)?[ \\t/*#@]*${field}:(.*)$`, 'mi').exec(head);
    if (!match) return null;
    const value = match[1].replace(/\s*(?:\*\/|\?>).*/, '').trim();
    return value === '' ? null : value;
}

function hasDir(entries: readonly InventoryEntry[], name: string): boolean {
    return entries.some((entry) => entry.type === 'dir' && entry.name === name);
}

function phpFiles(entries: readonly InventoryEntry[]): string[] {
    return entries
        .filter((entry) => entry.type === 'file' && entry.name.endsWith('.php'))
        .map((entry) => entry.name)
        .sort();
}

function withoutExtension(fileName: string): string {
    return fileName.slice(0, fileName.lastIndexOf('.'));
}

async function readPlugins(reader: InventoryReader): Promise<Component[]> {
    const dir = `${CONTENT_DIR}/plugins`;
    const entries = await reader.list(dir);
    const plugins: Component[] = [];

    // A PHP file directly under plugins/ is a plugin of its own when it carries a header; the stock index.php never does.
    for (const file of phpFiles(entries)) {
        if (file === 'index.php') continue;
        const text = await reader.readText(`${dir}/${file}`);
        const name = headerField(text, 'Plugin Name');
        if (name) {
            plugins.push({
                type: 'plugin',
                slug: withoutExtension(file),
                name,
                version: headerField(text, 'Version'),
            });
        }
    }

    for (const entry of entries) {
        if (entry.type !== 'dir') continue;
        const pluginDir = `${dir}/${entry.name}`;
        // Any PHP file at the root of the directory may be the main file. `<dir>/<dir>.php` is the convention and comes first, so one read settles almost every plugin; index.php is the least likely and comes last.
        const candidates = phpFiles(await reader.list(pluginDir)).sort(
            (a, b) => mainFileRank(a, entry.name) - mainFileRank(b, entry.name),
        );
        for (const file of candidates) {
            const text = await reader.readText(`${pluginDir}/${file}`);
            const name = headerField(text, 'Plugin Name');
            if (!name) continue;
            plugins.push({
                type: 'plugin',
                slug: entry.name,
                name,
                version: headerField(text, 'Version'),
            });
            break;
        }
    }
    return plugins;
}

function mainFileRank(fileName: string, dirName: string): number {
    if (fileName === `${dirName}.php`) return 0;
    return fileName === 'index.php' ? 2 : 1;
}

/** WordPress loads every PHP file at the root of mu-plugins/, header or not. */
async function readMustUsePlugins(reader: InventoryReader): Promise<Component[]> {
    const dir = `${CONTENT_DIR}/mu-plugins`;
    const plugins: Component[] = [];
    for (const file of phpFiles(await reader.list(dir))) {
        if (file === 'index.php') continue;
        const text = await reader.readText(`${dir}/${file}`);
        const slug = withoutExtension(file);
        plugins.push({
            type: 'mu-plugin',
            slug,
            name: headerField(text, 'Plugin Name') ?? slug,
            version: headerField(text, 'Version'),
        });
    }
    return plugins;
}

/** A theme is a directory with a style.css, whose header names it. */
async function readThemes(reader: InventoryReader): Promise<Component[]> {
    const dir = `${CONTENT_DIR}/themes`;
    const themes: Component[] = [];
    for (const entry of await reader.list(dir)) {
        if (entry.type !== 'dir') continue;
        const themeDir = `${dir}/${entry.name}`;
        const hasStylesheet = (await reader.list(themeDir)).some(
            (file) => file.type === 'file' && file.name === 'style.css',
        );
        if (!hasStylesheet) continue;
        const text = await reader.readText(`${themeDir}/style.css`);
        themes.push({
            type: 'theme',
            slug: entry.name,
            name: headerField(text, 'Theme Name') ?? entry.name,
            version: headerField(text, 'Version'),
        });
    }
    return themes;
}
