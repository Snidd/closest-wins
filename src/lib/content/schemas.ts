/**
 * Validation for content (locations, playlists, photos). Shared by the admin remote functions,
 * the MCP tools and client-side `preflight`, so the rules live once. Server-side persistence
 * lives in `#lib/server/content/`.
 *
 * Bilingual text: empty strings are normalised to null; at least one name is required, and a
 * location needs a photo or a clue text in at least one language (mirrors the DB CHECKs).
 *
 * Inputs never accept `null` (remote `form` inputs can only be strings, numbers, booleans and
 * files): send '' or omit a field to clear it on create. In *patch* schemas an omitted field is
 * left unchanged and '' clears it.
 *
 * A location's optional start view (`startLat`, `startLng`, `startZoom`: where the players' guess
 * maps open) is all three or none. An empty number field arrives as omitted, so a patch clears it
 * with `clearStartView: true` instead.
 */
import * as v from 'valibot';
import { MAX_LOCATION_LAT } from '#lib/geo.ts';
import { MAX_ZOOM, MIN_ZOOM } from '#lib/map/config.ts';

export const TEXT_MAX = { name: 120, clue: 1000, fact: 2000, attribution: 300 } as const;

export const LATITUDE_RANGE_MESSAGE = `Latitude must be between -${MAX_LOCATION_LAT} and ${MAX_LOCATION_LAT} (the map cannot show the poles)`;

/** Optional text: trimmed, '' / missing → null. */
const optionalText = (max: number) =>
	v.pipe(
		v.optional(v.string(), ''),
		v.transform((s) => s.trim() || null),
		v.nullable(v.pipe(v.string(), v.maxLength(max)))
	);

const Uuid = v.pipe(v.string(), v.uuid());
/** Optional uuid: '' / missing → null. */
const OptionalUuid = v.pipe(
	v.optional(v.string(), ''),
	v.transform((s) => s.trim() || null),
	v.nullable(Uuid)
);

/** Within what the (Web Mercator) map can show and a phone can aim at: ±`MAX_LOCATION_LAT`. */
const Latitude = v.pipe(
	v.number(),
	v.finite(),
	v.minValue(-MAX_LOCATION_LAT, LATITUDE_RANGE_MESSAGE),
	v.maxValue(MAX_LOCATION_LAT, LATITUDE_RANGE_MESSAGE)
);
const Longitude = v.pipe(v.number(), v.finite(), v.minValue(-180), v.maxValue(180));

export const LocationFields = v.object({
	nameSv: optionalText(TEXT_MAX.name),
	nameEn: optionalText(TEXT_MAX.name),
	clueTextSv: optionalText(TEXT_MAX.clue),
	clueTextEn: optionalText(TEXT_MAX.clue),
	factSv: optionalText(TEXT_MAX.fact),
	factEn: optionalText(TEXT_MAX.fact),
	lat: Latitude,
	lng: Longitude,
	photoId: OptionalUuid,
	/** Start view of the players' guess map: centre and zoom, all three or none. */
	startLat: v.optional(Latitude),
	startLng: v.optional(Longitude),
	startZoom: v.optional(v.pipe(v.number(), v.finite(), v.minValue(MIN_ZOOM), v.maxValue(MAX_ZOOM)))
});

type LocationShape = v.InferOutput<typeof LocationFields>;

const hasName = (l: Pick<LocationShape, 'nameSv' | 'nameEn'>) => !!(l.nameSv || l.nameEn);
const hasClue = (l: Pick<LocationShape, 'photoId' | 'clueTextSv' | 'clueTextEn'>) =>
	!!(l.photoId || l.clueTextSv || l.clueTextEn);
/** How many of the three start view fields are given (valid: 0 or 3). */
const startViewCount = (l: Partial<Pick<LocationShape, 'startLat' | 'startLng' | 'startZoom'>>) =>
	[l.startLat, l.startLng, l.startZoom].filter((n) => n !== undefined).length;

export const START_VIEW_ALL_OR_NONE_MESSAGE =
	'A start view needs a latitude, a longitude and a zoom (or none of them)';
export const START_VIEW_CLEAR_AND_SET_MESSAGE = 'Either clear the start view or set it, not both';

/** Create a location. Without a start view the output has all three start fields `null`. */
export const LocationInputSchema = v.pipe(
	LocationFields,
	v.check((l) => hasName(l), 'A name in at least one language is required'),
	v.check((l) => hasClue(l), 'A photo or a clue text is required'),
	v.check((l) => startViewCount(l) % 3 === 0, START_VIEW_ALL_OR_NONE_MESSAGE),
	v.transform((l) => ({
		...l,
		startLat: l.startLat ?? null,
		startLng: l.startLng ?? null,
		startZoom: l.startZoom ?? null
	}))
);

/**
 * Patch a location. Omitted fields are left unchanged; the merged row must still satisfy the
 * create rules (checked by the content module against the stored row). The start view is left
 * unchanged (none of the three given), set (all three) or cleared (`clearStartView` alone).
 */
export const LocationPatchSchema = v.pipe(
	v.object({
		id: Uuid,
		...v.partial(LocationFields).entries,
		clearStartView: v.optional(v.boolean(), false)
	}),
	v.check((p) => startViewCount(p) % 3 === 0, START_VIEW_ALL_OR_NONE_MESSAGE),
	v.check((p) => !(p.clearStartView && startViewCount(p) > 0), START_VIEW_CLEAR_AND_SET_MESSAGE)
);

export const PlaylistFields = v.object({
	nameSv: optionalText(TEXT_MAX.name),
	nameEn: optionalText(TEXT_MAX.name),
	defaultTimerSeconds: v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(600))
});

export const PlaylistInputSchema = v.pipe(
	PlaylistFields,
	v.check((l) => hasName(l), 'A name in at least one language is required')
);

export const PlaylistPatchSchema = v.object({
	id: Uuid,
	...v.partial(PlaylistFields).entries
});

/** Replace a playlist's items with this ordered list (duplicates rejected). */
export const SetPlaylistItemsSchema = v.object({
	playlistId: Uuid,
	locationIds: v.pipe(
		v.array(Uuid),
		v.maxLength(500),
		v.check((ids) => new Set(ids).size === ids.length, 'A location can only appear once')
	)
});

export const IdSchema = v.object({ id: Uuid });

/** Set (uuid) or clear (null) a location's photo. Command-only (accepts null). */
export const AttachPhotoSchema = v.object({ locationId: Uuid, photoId: v.nullable(Uuid) });

export const ListQuerySchema = v.object({
	/** Free-text search over names and clue/fact texts in both languages. */
	query: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
	/** Only locations where a text (name, clue, fact) exists in one language but not this one. */
	missingTranslation: v.optional(v.picklist(['sv', 'en', 'any'])),
	limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(200)), 50),
	offset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0)
});

const PhotoMeta = {
	attribution: optionalText(TEXT_MAX.attribution),
	sourceUrl: v.pipe(
		v.optional(v.string(), ''),
		v.transform((s) => s.trim() || null),
		v.nullable(v.pipe(v.string(), v.url(), v.maxLength(2000)))
	)
};

/** Import a photo by URL (admin UI and MCP). Optionally attach it to a location. */
export const ImportPhotoSchema = v.object({
	url: v.pipe(v.string(), v.trim(), v.url(), v.maxLength(2000)),
	locationId: v.optional(Uuid),
	...PhotoMeta
});

/** Upload a photo from the admin UI (multipart form). */
export const UploadPhotoSchema = v.object({
	file: v.file(),
	locationId: v.optional(Uuid),
	...PhotoMeta
});

export type LocationInput = v.InferOutput<typeof LocationInputSchema>;
export type LocationPatch = v.InferOutput<typeof LocationPatchSchema>;
export type PlaylistInput = v.InferOutput<typeof PlaylistInputSchema>;
export type PlaylistPatch = v.InferOutput<typeof PlaylistPatchSchema>;
export type SetPlaylistItemsInput = v.InferOutput<typeof SetPlaylistItemsSchema>;
export type ListQuery = v.InferOutput<typeof ListQuerySchema>;
export type AttachPhotoInput = v.InferOutput<typeof AttachPhotoSchema>;
export type ImportPhotoInput = v.InferOutput<typeof ImportPhotoSchema>;
export type UploadPhotoInput = v.InferOutput<typeof UploadPhotoSchema>;
