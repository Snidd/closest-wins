/**
 * Idempotent sample content: `pnpm seed` (reads DATABASE_URL from .env when present).
 * Upserts the seed locations and playlists by fixed id and rewrites the seed playlists' items.
 * Never touches other content or games.
 */
import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema.ts';
import { LOCATIONS, PLAYLISTS } from './seed-data.ts';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set (copy .env.example to .env)');
	process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema });
const { location, playlist, playlistItem } = schema;

try {
	await db.transaction(async (tx) => {
		for (const l of LOCATIONS) {
			const { id, ...fields } = l;
			await tx
				.insert(location)
				.values(l)
				.onConflictDoUpdate({ target: location.id, set: { ...fields, updatedAt: sql`now()` } });
		}

		for (const p of PLAYLISTS) {
			const { locationIds, id, ...fields } = p;
			await tx
				.insert(playlist)
				.values({ id, ...fields })
				.onConflictDoUpdate({ target: playlist.id, set: { ...fields, updatedAt: sql`now()` } });
		}

		const ids = PLAYLISTS.map((p) => p.id);
		await tx.delete(playlistItem).where(inArray(playlistItem.playlistId, ids));
		await tx.insert(playlistItem).values(
			PLAYLISTS.flatMap((p) =>
				p.locationIds.map((locationId, position) => ({ playlistId: p.id, locationId, position }))
			)
		);
	});
	console.log(`Seeded ${LOCATIONS.length} locations and ${PLAYLISTS.length} playlists.`);
} catch (e) {
	console.error('Seeding failed:', e);
	process.exitCode = 1;
} finally {
	await client.end();
}
