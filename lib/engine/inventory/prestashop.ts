import type { CmsAdapter, Component, InventoryEntry, InventoryReader } from './types';

const KERNEL_FILE = 'app/AppKernel.php';
/** Directories every PrestaShop root has since 1.7; none of them alone is telling, the set is. */
const ROOT_DIRS = ['app', 'classes', 'config', 'modules', 'themes'];

/**
 * PrestaShop, verified on 8.x: the core version from the constants of `app/AppKernel.php`, a module from the constructor of `modules/<name>/<name>.php`, a theme from its `config/theme.yml`. Whether a module is installed or enabled lives in the database, so every module present in the files is reported.
 */
export const prestashop: CmsAdapter = {
    id: 'prestashop',

    detect: (rootEntries) => ROOT_DIRS.every((name) => hasDir(rootEntries, name)),

    async read(reader) {
        const version = parseCoreVersion(await reader.readText(KERNEL_FILE));
        if (!version) throw new Error(`No version constants found in ${KERNEL_FILE}`);
        return {
            version,
            components: [...(await readModules(reader)), ...(await readThemes(reader))],
        };
    },
};

/**
 * 8.x declares `VERSION = Version::VERSION`, a reference to another class, next to three integers that spell the version: `MAJOR_VERSION = 8`, `MINOR_VERSION = 2`, `RELEASE_VERSION = 3`. 1.7 wrote the version as a literal (`VERSION = '1.7.8.10'`) and its `MAJOR_VERSION` is 17, so a literal wins when there is one.
 */
export function parseCoreVersion(text: string): string | null {
    const literal = /const\s+VERSION\s*=\s*(['"])([^'"]+)\1/.exec(text)?.[2];
    if (literal) return literal;
    const part = (name: string) =>
        new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(text)?.[1] ?? null;
    const parts = [part('MAJOR_VERSION'), part('MINOR_VERSION'), part('RELEASE_VERSION')];
    return parts.every((value) => value !== null) ? parts.join('.') : null;
}

/** `$this->version = '2.1.2';` in the module's constructor. */
export function parseModuleVersion(text: string): string | null {
    return /\$this->version\s*=\s*(['"])([^'"]+)\1/.exec(text)?.[2] ?? null;
}

/**
 * The first string literal assigned to `$this->displayName`, whether bare or passed through a translation call: `$this->trans('Banner', [], 'Modules.Banner.Admin')`, `$this->l('Banner')`.
 */
export function parseModuleName(text: string): string | null {
    const match =
        /\$this->displayName\s*=\s*(?:\$this->(?:trans|l)\s*\(\s*)?(['"])((?:\\.|(?!\1)[^\\])*)\1/.exec(
            text,
        );
    if (!match) return null;
    const name = match[2].replace(/\\(.)/g, '$1').trim();
    return name === '' ? null : name;
}

/** Value of a top-level `key: value` line of a YAML file, quotes and trailing comment removed. Enough for the scalar fields of `theme.yml`, not a YAML parser. */
export function yamlField(text: string, key: string): string | null {
    const match = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(text.replace(/\r/g, ''));
    if (!match) return null;
    const raw = match[1].trim();
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    const value = quoted ? quoted[2] : raw.replace(/\s+#.*$/, '');
    return value === '' || value === '~' ? null : value;
}

function hasDir(entries: readonly InventoryEntry[], name: string): boolean {
    return entries.some((entry) => entry.type === 'dir' && entry.name === name);
}

function hasFile(entries: readonly InventoryEntry[], name: string): boolean {
    return entries.some((entry) => entry.type === 'file' && entry.name === name);
}

/** A module is a directory holding a PHP file of its own name. Anything else under modules/ (the stock index.php, archive leftovers) is not one. */
async function readModules(reader: InventoryReader): Promise<Component[]> {
    const modules: Component[] = [];
    for (const entry of await reader.list('modules')) {
        if (entry.type !== 'dir') continue;
        const mainFile = `${entry.name}.php`;
        if (!hasFile(await reader.list(`modules/${entry.name}`), mainFile)) continue;
        const text = await reader.readText(`modules/${entry.name}/${mainFile}`);
        modules.push({
            type: 'module',
            slug: entry.name,
            name: parseModuleName(text) ?? entry.name,
            version: parseModuleVersion(text),
        });
    }
    return modules;
}

/** A theme is a directory with a `config/theme.yml`. */
async function readThemes(reader: InventoryReader): Promise<Component[]> {
    const themes: Component[] = [];
    for (const entry of await reader.list('themes')) {
        if (entry.type !== 'dir') continue;
        const themeDir = `themes/${entry.name}`;
        if (!hasDir(await reader.list(themeDir), 'config')) continue;
        if (!hasFile(await reader.list(`${themeDir}/config`), 'theme.yml')) continue;
        const text = await reader.readText(`${themeDir}/config/theme.yml`);
        themes.push({
            type: 'theme',
            slug: entry.name,
            name: yamlField(text, 'display_name') ?? yamlField(text, 'name') ?? entry.name,
            version: yamlField(text, 'version'),
        });
    }
    return themes;
}
