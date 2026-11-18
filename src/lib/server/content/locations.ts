/**
 * Locations: the ONLY module that reads or writes the `location` table (admin remote functions
 * and MCP tools both go through here). Inputs are the *output* types of the schemas in
 * `#lib/content/schemas.ts` (use `parseContent(schema, raw)` first for raw input); the rules are
 * checked again here on the complete row. Expected failures throw `ContentError`:
 * `NOT_FOUND` (no such location), `INVALID` (rules, unknown photo), `IN_USE` (delete of a played
 * location).
 */
import { and, count, countDistinct, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Locale } from '#lib/i18n/locale.ts';
import {
	START_VIEW_CLEAR_AND_SET_MESSAGE,
	type LocationInput,
	type LocationPatch,
	type ListQuery
} from '#lib/content/schemas.ts';
import { db } from '#lib/server/db/index.ts';
import {
	gameRound,
	location,
	photo,
	playlistItem,
	type Location,
	type Photo
} from '#lib/server/db/schema.ts';
import { ContentError } from './errors.ts';
import { deletePhotoIfUnused, photoExists } from './photos.ts';
import { renumberPlaylistItems } from './playlists.ts';
import { checkLocation, clean, escapeLike, isUuid, pgCode, translationGap } from './validate.ts';

export type LocationWithPhoto = Location & { photo: Photo | null };

export type LocationListItem = LocationWithPhoto & {
	/**
	 * Languages missing per bilingual field (translation badges): the missing language when only
	 * one is filled in; [] when both are filled or the (optional) field is empty in both.
	 */
	missing: { name: Locale[]; clueText: Locale[]; fact: Locale[] };
	playlistCount: number;
};

/** Translation gaps of a location (see `LocationListItem.missing`). */
export function locationMissing(l: Location): LocationListItem['missing'] {
	return {
		name: translationGap(l.nameSv, l.nameEn),
		clueText: translationGap(l.clueTextSv, l.clueTextEn),
		fact: translationGap(l.factSv, l.factEn)
	};
}

const SEARCH_COLUMNS = [
	location.nameSv,
	location.nameEn,
	location.clueTextSv,
	location.clueTextEn,
	location.factSv,
	location.factEn
];

/** Every word must appear in at least one of the six text columns (case-insensitive). */
function searchCondition(query: string | undefined): SQL | undefined {
	const words = (query ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
	if (words.length === 0) return undefined;
	return and(
		...words.map((w) => or(...SEARCH_COLUMNS.map((c) => ilike(c, `%${escapeLike(w)}%`))))
	);
}

const PAIRS = [
	[location.nameSv, location.nameEn],
	[location.clueTextSv, location.clueTextEn],
	[location.factSv, location.factEn]
] as const;
const isFilled = (c: (typeof PAIRS)[number][number]) => sql`(${c} IS NOT NULL AND btrim(${c}) <> '')`;

/** Some text pair is filled in the other language only (same rule as `translationGap`). */
function missingCondition(missing: ListQuery['missingTranslation']): SQL | undefined {
	if (!missing) return undefined;
	return or(
		...PAIRS.map(([sv, en]) => {
			if (missing === 'sv') return sql`(NOT ${isFilled(sv)} AND ${isFilled(en)})`;
			if (missing === 'en') return sql`(${isFilled(sv)} AND NOT ${isFilled(en)})`;
			return sql`(${isFilled(sv)} <> ${isFilled(en)})`;
		})
	);
}

/**
 * Newest-edited first. `query` searches names, clue texts and facts in both languages;
 * `missingTranslation` keeps only locations with a text to translate into that language.
 */
export async function listLocations(
	query: ListQuery
): Promise<{ items: LocationListItem[]; total: number }> {
	const where = and(searchCondition(query.query), missingCondition(query.missingTranslation));
	const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
	const offset = Math.max(query.offset ?? 0, 0);

	const playlistCount = sql<number>`(select count(*)::int from playlist_item pi where pi.location_id = "location"."id")`;
	const [rows, [totalRow]] = await Promise.all([
		db
			.select({ location, photo, playlistCount })
			.from(location)
			.leftJoin(photo, eq(location.photoId, photo.id))
			.where(where)
			.orderBy(desc(location.updatedAt), location.id)
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(location).where(where)
	]);

	return {
		items: rows.map((r) => ({
			...r.location,
			photo: r.photo,
			missing: locationMissing(r.location),
			playlistCount: Number(r.playlistCount)
		})),
		total: totalRow?.n ?? 0
	};
}

export async function getLocation(id: string): Promise<LocationWithPhoto | null> {
	if (!isUuid(id)) return null;
	const row = await db.query.location.findFirst({
		where: eq(location.id, id),
		with: { photo: true }
	});
	return row ?? null;
}

function normalize(input: LocationInput) {
	return {
		nameSv: clean(input.nameSv),
		nameEn: clean(input.nameEn),
		clueTextSv: clean(input.clueTextSv),
		clueTextEn: clean(input.clueTextEn),
		factSv: clean(input.factSv),
		factEn: clean(input.factEn),
		lat: input.lat,
		lng: input.lng,
		photoId: input.photoId ?? null,
		startLat: input.startLat,
		startLng: input.startLng,
		startZoom: input.startZoom
	};
}

/** Maps constraint violations that slipped past the checks above (races) to `INVALID`. */
function mapDbError(e: unknown): never {
	const code = pgCode(e);
	if (code === '23514') throw new ContentError('INVALID', 'The location breaks a content rule');
	if (code === '23503') throw new ContentError('INVALID', 'The photo does not exist');
	if (code === '22P02') throw new ContentError('INVALID', 'Invalid id');
	throw e;
}

export async function createLocation(input: LocationInput): Promise<Location> {
	const values = normalize(input);
	checkLocation(values);
	if (values.photoId && !(await photoExists(values.photoId))) {
		throw new ContentError('INVALID', 'The photo does not exist');
	}
	try {
		const [row] = await db.insert(location).values(values).returning();
		return row!;
	} catch (e) {
		mapDbError(e);
	}
}

const PATCH_TEXT_FIELDS = ['nameSv', 'nameEn', 'clueTextSv', 'clueTextEn', 'factSv', 'factEn'] as const;

/**
 * Applies the patch; the merged row must still have a name and a photo or clue text, and a start
 * view with all three fields or none. `clearStartView` (default false) removes the start view.
 */
export async function updateLocation(
	patch: Omit<LocationPatch, 'clearStartView'> & { clearStartView?: boolean }
): Promise<Location> {
	if (!isUuid(patch.id)) throw new ContentError('NOT_FOUND', 'Location not found');

	const changes: Partial<typeof location.$inferInsert> = {};
	for (const f of PATCH_TEXT_FIELDS) {
		if (patch[f] !== undefined) changes[f] = clean(patch[f]);
	}
	if (patch.lat !== undefined) changes.lat = patch.lat;
	if (patch.lng !== undefined) changes.lng = patch.lng;
	if (patch.photoId !== undefined) changes.photoId = patch.photoId ?? null;
	if (patch.clearStartView) {
		if (patch.startLat !== undefined || patch.startLng !== undefined || patch.startZoom !== undefined) {
			throw new ContentError('INVALID', START_VIEW_CLEAR_AND_SET_MESSAGE);
		}
		changes.startLat = changes.startLng = changes.startZoom = null;
	} else {
		if (patch.startLat !== undefined) changes.startLat = patch.startLat;
		if (patch.startLng !== undefined) changes.startLng = patch.startLng;
		if (patch.startZoom !== undefined) changes.startZoom = patch.startZoom;
	}

	let previousPhotoId: string | null = null;
	let updated: Location;
	try {
		updated = await db.transaction(async (tx) => {
			const [current] = await tx
				.select()
				.from(location)
				.where(eq(location.id, patch.id))
				.for('update');
			if (!current) throw new ContentError('NOT_FOUND', 'Location not found');

			const merged = { ...current, ...changes };
			checkLocation(merged);
			if (merged.photoId && merged.photoId !== current.photoId && !(await photoExists(merged.photoId, tx))) {
				throw new ContentError('INVALID', 'The photo does not exist');
			}
			previousPhotoId = current.photoId;
			const [row] = await tx
				.update(location)
				.set({ ...changes, updatedAt: new Date() })
				.where(eq(location.id, patch.id))
				.returning();
			return row!;
		});
	} catch (e) {
		if (e instanceof ContentError) throw e;
		mapDbError(e);
	}

	if (previousPhotoId && previousPhotoId !== updated.photoId) {
		await deletePhotoIfUnused(previousPhotoId);
	}
	return updated;
}

/**
 * Sets or clears a location's photo (used by `attachPhoto` and photo uploads/imports). A replaced
 * photo that no other location uses is deleted. Throws `NOT_FOUND`, or `INVALID` when the photo
 * does not exist or clearing it would leave the location without any clue.
 */
export async function setLocationPhoto(locationId: string, photoId: string | null): Promise<void> {
	try {
		await updateLocation({ id: locationId, photoId });
	} catch (e) {
		if (e instanceof ContentError && e.code === 'INVALID' && /photo or a clue/.test(e.message)) {
			throw new ContentError('INVALID', 'The location needs a photo or a clue text; add a clue text first');
		}
		throw e;
	}
}

/** Fails with `IN_USE` if the location was played in a game (game history keeps it). */
export async function deleteLocation(id: string): Promise<void> {
	if (!isUuid(id)) throw new ContentError('NOT_FOUND', 'Location not found');
	let photoId: string | null = null;
	try {
		await db.transaction(async (tx) => {
			const [current] = await tx.select().from(location).where(eq(location.id, id)).for('update');
			if (!current) throw new ContentError('NOT_FOUND', 'Location not found');

			const [played] = await tx
				.select({ n: count() })
				.from(gameRound)
				.where(eq(gameRound.locationId, id));
			if ((played?.n ?? 0) > 0) {
				throw new ContentError(
					'IN_USE',
					`The location was played in ${played!.n} game round(s) and is kept for the game history`
				);
			}

			const playlists = await tx
				.select({ playlistId: playlistItem.playlistId })
				.from(playlistItem)
				.where(eq(playlistItem.locationId, id));
			await tx.delete(location).where(eq(location.id, id)); // playlist items cascade
			await renumberPlaylistItems(
				tx,
				playlists.map((p) => p.playlistId)
			);
			photoId = current.photoId;
		});
	} catch (e) {
		if (e instanceof ContentError) throw e;
		// A game round was created between the check and the delete (FK is RESTRICT).
		if (pgCode(e) === '23503') {
			throw new ContentError('IN_USE', 'The location was played in a game and is kept for the game history');
		}
		throw e;
	}
	if (photoId) await deletePhotoIfUnused(photoId);
}

export async function locationUsage(id: string): Promise<{ playlists: number; games: number }> {
	if (!isUuid(id)) throw new ContentError('NOT_FOUND', 'Location not found');
	const [exists] = await db.select({ id: location.id }).from(location).where(eq(location.id, id));
	if (!exists) throw new ContentError('NOT_FOUND', 'Location not found');
	const [[p], [g]] = await Promise.all([
		db.select({ n: count() }).from(playlistItem).where(eq(playlistItem.locationId, id)),
		db.select({ n: countDistinct(gameRound.gameId) }).from(gameRound).where(eq(gameRound.locationId, id))
	]);
	return { playlists: p?.n ?? 0, games: g?.n ?? 0 };
}
