/**
 * The engine's read-only window onto content (locations, playlists, photos).
 *
 * The content module (`#lib/server/content/`) has no reads shaped for the game: its
 * `getLocation` / `getPlaylist` return whole rows, including the answer. The engine must not
 * select the target while a round runs, so these narrow selects live here, split by what may
 * be read when:
 * - `clues` (no coordinates, name, fact or photo credit): always.
 * - `startViews` (only the admin-chosen start view of the guess map, from its own columns; never
 *   the coordinates): always, for player snapshots only.
 * - `targets`, `revealedClues`: only for rounds that have ended (round end, reveal, standings,
 *   history).
 * Nothing here writes. Candidates to move into `#lib/server/content/` as-is.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db, type Executor } from '#lib/server/db/index.ts';
import { location, photo, playlist, playlistItem } from '#lib/server/db/schema.ts';
import type {
	BilingualName,
	ClueView,
	MapStartView,
	RevealedClueView,
	RevealTarget
} from '#lib/game/types.ts';
import { toCluePhotoView, toPhotoView } from '#lib/server/content/photos.ts';

/** The playlist's location ids in order, or null if the playlist does not exist. */
export async function playlistLocationIds(
	playlistId: string,
	ex: Executor = db
): Promise<string[] | null> {
	const [exists] = await ex
		.select({ id: playlist.id })
		.from(playlist)
		.where(eq(playlist.id, playlistId));
	if (!exists) return null;
	const rows = await ex
		.select({ id: playlistItem.locationId })
		.from(playlistItem)
		.where(eq(playlistItem.playlistId, playlistId))
		.orderBy(asc(playlistItem.position));
	return rows.map((r) => r.id);
}

export async function playlistNames(
	ids: readonly string[],
	ex: Executor = db
): Promise<Map<string, BilingualName>> {
	if (ids.length === 0) return new Map();
	const rows = await ex
		.select({ id: playlist.id, nameSv: playlist.nameSv, nameEn: playlist.nameEn })
		.from(playlist)
		.where(inArray(playlist.id, [...new Set(ids)]));
	return new Map(rows.map((r) => [r.id, { nameSv: r.nameSv, nameEn: r.nameEn }]));
}

/**
 * Clue text and photo image per location. Never selects coordinates, name, fact or the photo's
 * credit/source (those can name the place: see `revealedClues`).
 */
export async function clues(
	locationIds: readonly string[],
	ex: Executor = db
): Promise<Map<string, ClueView>> {
	if (locationIds.length === 0) return new Map();
	const rows = await ex
		.select({
			id: location.id,
			textSv: location.clueTextSv,
			textEn: location.clueTextEn,
			fileKey: photo.fileKey,
			width: photo.width,
			height: photo.height
		})
		.from(location)
		.leftJoin(photo, eq(photo.id, location.photoId))
		.where(inArray(location.id, [...new Set(locationIds)]));
	return new Map(
		rows.map(({ id, textSv, textEn, fileKey, width, height }) => [
			id,
			{
				textSv,
				textEn,
				photo: fileKey !== null && width !== null && height !== null ? toCluePhotoView({ fileKey, width, height }) : null
			}
		])
	);
}

/**
 * The guess map's start view per location; locations without one are left out. Selects only the
 * three start view columns (never the coordinates, name, fact or photo credit).
 */
export async function startViews(
	locationIds: readonly string[],
	ex: Executor = db
): Promise<Map<string, MapStartView>> {
	if (locationIds.length === 0) return new Map();
	const rows = await ex
		.select({
			id: location.id,
			startLat: location.startLat,
			startLng: location.startLng,
			startZoom: location.startZoom
		})
		.from(location)
		.where(inArray(location.id, [...new Set(locationIds)]));
	const views = new Map<string, MapStartView>();
	for (const { id, startLat, startLng, startZoom } of rows) {
		if (startLat !== null && startLng !== null && startZoom !== null) {
			views.set(id, { lat: startLat, lng: startLng, zoom: startZoom });
		}
	}
	return views;
}

/** Clues including the photo credit and source. ONLY call for rounds that have ended. */
export async function revealedClues(
	locationIds: readonly string[],
	ex: Executor = db
): Promise<Map<string, RevealedClueView>> {
	if (locationIds.length === 0) return new Map();
	const rows = await ex
		.select({
			id: location.id,
			textSv: location.clueTextSv,
			textEn: location.clueTextEn,
			photo: {
				fileKey: photo.fileKey,
				width: photo.width,
				height: photo.height,
				attribution: photo.attribution,
				sourceUrl: photo.sourceUrl
			}
		})
		.from(location)
		.leftJoin(photo, eq(photo.id, location.photoId))
		.where(inArray(location.id, [...new Set(locationIds)]));
	return new Map(
		rows.map((r) => [r.id, { textSv: r.textSv, textEn: r.textEn, photo: r.photo ? toPhotoView(r.photo) : null }])
	);
}

/** The answers. ONLY call for rounds that have ended. */
export async function targets(
	locationIds: readonly string[],
	ex: Executor = db
): Promise<Map<string, RevealTarget>> {
	if (locationIds.length === 0) return new Map();
	const rows = await ex
		.select({
			id: location.id,
			lat: location.lat,
			lng: location.lng,
			nameSv: location.nameSv,
			nameEn: location.nameEn,
			factSv: location.factSv,
			factEn: location.factEn
		})
		.from(location)
		.where(inArray(location.id, [...new Set(locationIds)]));
	return new Map(rows.map(({ id, ...t }) => [id, t]));
}

/** Every location id in the library (sudden-death pool). */
export async function allLocationIds(ex: Executor = db): Promise<string[]> {
	const rows = await ex.select({ id: location.id }).from(location);
	return rows.map((r) => r.id);
}
