/**
 * Playlists: the ONLY module that reads or writes `playlist` / `playlist_item`. Expected failures
 * throw `ContentError`: `NOT_FOUND` (no such playlist), `INVALID` (rules, unknown or duplicate
 * location ids).
 */
import { asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { PlaylistInput, PlaylistPatch, SetPlaylistItemsInput } from '#lib/content/schemas.ts';
import { TEXT_MAX } from '#lib/content/schemas.ts';
import { db, type Executor } from '#lib/server/db/index.ts';
import { location, playlist, playlistItem, type Playlist } from '#lib/server/db/schema.ts';
import { ContentError } from './errors.ts';
import type { LocationWithPhoto } from './locations.ts';
import { checkLength, clean, filled, isUuid, pgCode } from './validate.ts';

export type PlaylistSummary = Playlist & {
	locationCount: number;
	/** Locations in the playlist missing a language in name, clue text or fact. */
	missingTranslationCount: number;
};

export type PlaylistWithItems = Playlist & {
	items: Array<{ position: number; location: LocationWithPhoto }>;
};

/** SQL: exactly one of the two columns is filled in (a translation gap, see `translationGap`). */
const gap = (sv: string, en: string) =>
	`((${sv} IS NOT NULL AND btrim(${sv}) <> '') <> (${en} IS NOT NULL AND btrim(${en}) <> ''))`;
const LOCATION_HAS_GAP = sql.raw(
	[gap('l.name_sv', 'l.name_en'), gap('l.clue_text_sv', 'l.clue_text_en'), gap('l.fact_sv', 'l.fact_en')].join(
		' OR '
	)
);

/**
 * Most recently edited first. (Correlated subqueries name the outer column explicitly: drizzle
 * renders `${playlist.id}` unqualified in single-table selects, which would bind to `l.id`.)
 */
export async function listPlaylists(): Promise<PlaylistSummary[]> {
	const rows = await db
		.select({
			playlist,
			locationCount: sql<number>`(select count(*)::int from playlist_item pi where pi.playlist_id = "playlist"."id")`,
			missingTranslationCount: sql<number>`(select count(*)::int from playlist_item pi join location l on l.id = pi.location_id where pi.playlist_id = "playlist"."id" and (${LOCATION_HAS_GAP}))`
		})
		.from(playlist)
		.orderBy(desc(playlist.updatedAt), playlist.id);
	return rows.map((r) => ({
		...r.playlist,
		locationCount: Number(r.locationCount),
		missingTranslationCount: Number(r.missingTranslationCount)
	}));
}

export async function getPlaylist(id: string): Promise<PlaylistWithItems | null> {
	if (!isUuid(id)) return null;
	const row = await db.query.playlist.findFirst({
		where: eq(playlist.id, id),
		with: {
			items: {
				orderBy: [asc(playlistItem.position)],
				with: { location: { with: { photo: true } } }
			}
		}
	});
	if (!row) return null;
	const { items, ...rest } = row;
	return { ...rest, items: items.map((i) => ({ position: i.position, location: i.location })) };
}

function checkPlaylist(p: { nameSv: string | null; nameEn: string | null; defaultTimerSeconds: number }) {
	if (!filled(p.nameSv) && !filled(p.nameEn)) {
		throw new ContentError('INVALID', 'A name in at least one language is required');
	}
	if (!Number.isInteger(p.defaultTimerSeconds) || p.defaultTimerSeconds < 5 || p.defaultTimerSeconds > 600) {
		throw new ContentError('INVALID', 'The timer must be a whole number of seconds between 5 and 600');
	}
	checkLength('nameSv', p.nameSv, TEXT_MAX.name);
	checkLength('nameEn', p.nameEn, TEXT_MAX.name);
}

export async function createPlaylist(input: PlaylistInput): Promise<Playlist> {
	const values = {
		nameSv: clean(input.nameSv),
		nameEn: clean(input.nameEn),
		defaultTimerSeconds: input.defaultTimerSeconds
	};
	checkPlaylist(values);
	const [row] = await db.insert(playlist).values(values).returning();
	return row!;
}

export async function updatePlaylist(patch: PlaylistPatch): Promise<Playlist> {
	if (!isUuid(patch.id)) throw new ContentError('NOT_FOUND', 'Playlist not found');
	const changes: Partial<typeof playlist.$inferInsert> = {};
	if (patch.nameSv !== undefined) changes.nameSv = clean(patch.nameSv);
	if (patch.nameEn !== undefined) changes.nameEn = clean(patch.nameEn);
	if (patch.defaultTimerSeconds !== undefined) changes.defaultTimerSeconds = patch.defaultTimerSeconds;

	return db.transaction(async (tx) => {
		const [current] = await tx.select().from(playlist).where(eq(playlist.id, patch.id)).for('update');
		if (!current) throw new ContentError('NOT_FOUND', 'Playlist not found');
		checkPlaylist({ ...current, ...changes });
		const [row] = await tx
			.update(playlist)
			.set({ ...changes, updatedAt: new Date() })
			.where(eq(playlist.id, patch.id))
			.returning();
		return row!;
	});
}

/** Games keep their rounds; `game.playlist_id` becomes null. */
export async function deletePlaylist(id: string): Promise<void> {
	if (!isUuid(id)) throw new ContentError('NOT_FOUND', 'Playlist not found');
	const deleted = await db.delete(playlist).where(eq(playlist.id, id)).returning({ id: playlist.id });
	if (deleted.length === 0) throw new ContentError('NOT_FOUND', 'Playlist not found');
}

function checkItemIds(locationIds: readonly string[]): void {
	if (new Set(locationIds).size !== locationIds.length) {
		throw new ContentError('INVALID', 'A location can only appear once');
	}
	if (locationIds.length > 500) throw new ContentError('INVALID', 'A playlist can have at most 500 locations');
	const bad = locationIds.filter((id) => !isUuid(id));
	if (bad.length) throw new ContentError('INVALID', `Unknown location(s): ${bad.join(', ')}`);
}

/**
 * Runs `edit` on the playlist's current item list inside one transaction that holds the
 * playlist row lock, then writes the list it returns (positions 0..n-1). Concurrent edits
 * (admin reorder, MCP add/remove) serialise instead of overwriting each other.
 */
async function editPlaylistItems<T>(
	playlistId: string,
	edit: (current: string[]) => { next: string[]; result: T }
): Promise<T> {
	if (!isUuid(playlistId)) throw new ContentError('NOT_FOUND', 'Playlist not found');
	try {
		return await db.transaction(async (tx) => {
			const [current] = await tx
				.select({ id: playlist.id })
				.from(playlist)
				.where(eq(playlist.id, playlistId))
				.for('update');
			if (!current) throw new ContentError('NOT_FOUND', 'Playlist not found');
			const rows = await tx
				.select({ locationId: playlistItem.locationId })
				.from(playlistItem)
				.where(eq(playlistItem.playlistId, playlistId))
				.orderBy(asc(playlistItem.position));
			const before = rows.map((r) => r.locationId);
			const { next, result } = edit(before);
			if (next.length === before.length && next.every((id, i) => id === before[i])) return result;
			checkItemIds(next);

			const added = next.filter((id) => !before.includes(id));
			if (added.length) {
				const found = await tx.select({ id: location.id }).from(location).where(inArray(location.id, added));
				const foundIds = new Set(found.map((r) => r.id));
				const missing = added.filter((id) => !foundIds.has(id));
				if (missing.length) throw new ContentError('INVALID', `Unknown location(s): ${missing.join(', ')}`);
			}

			// Delete first: (playlist_id, position) is unique and not deferrable.
			await tx.delete(playlistItem).where(eq(playlistItem.playlistId, playlistId));
			if (next.length) {
				await tx
					.insert(playlistItem)
					.values(next.map((locationId, position) => ({ playlistId, locationId, position })));
			}
			await tx.update(playlist).set({ updatedAt: new Date() }).where(eq(playlist.id, playlistId));
			return result;
		});
	} catch (e) {
		if (e instanceof ContentError) throw e;
		// A location was deleted concurrently.
		if (pgCode(e) === '23503') throw new ContentError('INVALID', 'A location no longer exists');
		throw e;
	}
}

/** Replaces all items with `locationIds` in order (positions 0..n-1), in one transaction. */
export async function setPlaylistItems(input: SetPlaylistItemsInput): Promise<void> {
	checkItemIds(input.locationIds);
	await editPlaylistItems(input.playlistId, () => ({ next: [...input.locationIds], result: undefined }));
}

/**
 * Adds locations (in the given order) at a 0-based `position` (default: the end), atomically.
 * Ids already in the playlist are skipped, not moved.
 */
export async function addPlaylistItems(
	playlistId: string,
	locationIds: readonly string[],
	position?: number
): Promise<{ added: string[]; alreadyInPlaylist: string[] }> {
	return editPlaylistItems(playlistId, (current) => {
		const present = new Set(current);
		const requested = [...new Set(locationIds)];
		const added = requested.filter((id) => !present.has(id));
		const alreadyInPlaylist = requested.filter((id) => present.has(id));
		const at = Math.min(Math.max(position ?? current.length, 0), current.length);
		return {
			next: [...current.slice(0, at), ...added, ...current.slice(at)],
			result: { added, alreadyInPlaylist }
		};
	});
}

/** Removes locations from the playlist (not from the library), atomically. */
export async function removePlaylistItems(
	playlistId: string,
	locationIds: readonly string[]
): Promise<{ removed: string[]; notInPlaylist: string[] }> {
	return editPlaylistItems(playlistId, (current) => {
		const drop = new Set(locationIds);
		return {
			next: current.filter((id) => !drop.has(id)),
			result: {
				removed: current.filter((id) => drop.has(id)),
				notInPlaylist: [...drop].filter((id) => !current.includes(id))
			}
		};
	});
}

/** Number of playlists (dashboard). */
export async function countPlaylists(): Promise<number> {
	const [row] = await db.select({ n: count() }).from(playlist);
	return row?.n ?? 0;
}

/**
 * Closes the gaps left in `position` after items were removed (e.g. a location was deleted and
 * its items cascaded). Two passes so the unique (playlist_id, position) index never collides.
 */
export async function renumberPlaylistItems(tx: Executor, playlistIds: string[]): Promise<void> {
	const ids = [...new Set(playlistIds)];
	if (ids.length === 0) return;
	const idList = sql.join(
		ids.map((id) => sql`${id}::uuid`),
		sql`, `
	);
	await tx.execute(
		sql`UPDATE playlist_item SET position = position + 1000000 WHERE playlist_id IN (${idList})`
	);
	await tx.execute(sql`
		UPDATE playlist_item pi SET position = r.rn - 1
		FROM (
			SELECT playlist_id, location_id,
				row_number() OVER (PARTITION BY playlist_id ORDER BY position) AS rn
			FROM playlist_item WHERE playlist_id IN (${idList})
		) r
		WHERE pi.playlist_id = r.playlist_id AND pi.location_id = r.location_id`);
}
