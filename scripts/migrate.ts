/**
 * Applies the committed SQL migrations in drizzle/ (same bookkeeping table as `drizzle-kit
 * migrate`, so both can be used on one database). Needs only production dependencies, so the
 * Docker image runs it on start: `node scripts/migrate.ts && node build`.
 */
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
	await migrate(drizzle(client), { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
	console.log('[migrate] database is up to date');
} catch (e) {
	console.error('[migrate] failed:', e);
	process.exitCode = 1;
} finally {
	await client.end();
}
