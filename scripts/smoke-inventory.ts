/**
 * Debug helper: runs the inventory engine against a real site from the local database and prints what it found. Read-only on the remote, nothing is stored locally either.
 *
 *   npx tsx scripts/smoke-inventory.ts <domain>
 */
import { getSiteConfig } from '../lib/db';
import { runInventory } from '../lib/engine/inventory';
import { initDatabase, prisma } from '../lib/prisma';

try {
    process.loadEnvFile('.env');
} catch {
    // .env is optional, variables may come from the environment
}

const domain = process.argv[2];
if (!domain) {
    console.error('Usage: npx tsx scripts/smoke-inventory.ts <domain>');
    process.exit(1);
}

await initDatabase();
const row = await prisma.site.findUnique({ where: { domain }, select: { id: true } });
const site = row ? await getSiteConfig(row.id) : null;
if (!site) {
    console.error(`Unknown site: ${domain}`);
    process.exit(1);
}

const result = await runInventory(site, {
    onLog: (entry) => console.log(`${entry.time} [${entry.level}] ${entry.msg}`),
});
if (result.inventory) {
    console.log(`\n${result.inventory.cms} ${result.inventory.version}`);
    console.table(result.inventory.components);
}

await prisma.$disconnect();
process.exitCode = result.status === 'success' ? 0 : 1;
