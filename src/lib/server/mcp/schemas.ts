/**
 * The ONE place where MCP tool schemas meet the shared content validation.
 *
 * The MCP SDK describes tool inputs/outputs with zod (it turns them into the JSON Schema that
 * clients see in `tools/list` and validates arguments with them). The content rules live once,
 * in valibot, in `#lib/content/schemas.ts`. So:
 *
 * - The zod input shapes below describe the wire format for the LLM: types, per-field
 *   descriptions and the same per-field limits (taken from `TEXT_MAX` / `LIMITS`; a parity test
 *   in `schemas.test.ts` probes both sides at the boundaries so they cannot drift apart).
 * - Every tool then converts its (zod-parsed) arguments with a `to*` function below, which runs
 *   `parseContent(<valibot schema>, raw)`. The valibot schema is authoritative: cross-field rules
 *   (a name, a clue) and anything the zod shape does not express are enforced there, and the
 *   content services check the merged row once more.
 *
 * Wire conventions: bilingual text is flat `<field>Sv` / `<field>En` like the DB rows. In patch
 * tools an omitted field is unchanged and `null` or `""` clears it (valibot patch schemas use
 * `""` for "clear", so `null` is mapped to `""` here). The start view is one nested `startView`
 * object (flat `startLat` / `startLng` / `startZoom` in valibot; `null` → `clearStartView`).
 */
import { z } from 'zod';
import { MAX_LOCATION_LAT } from '#lib/geo.ts';
import { MAX_ZOOM, MIN_ZOOM } from '#lib/map/config.ts';
import {
	ImportPhotoSchema,
	ListQuerySchema,
	LocationInputSchema,
	LocationPatchSchema,
	PlaylistInputSchema,
	PlaylistPatchSchema,
	SetPlaylistItemsSchema,
	TEXT_MAX,
	type ImportPhotoInput,
	type ListQuery,
	type LocationInput,
	type LocationPatch,
	type PlaylistInput,
	type PlaylistPatch,
	type SetPlaylistItemsInput
} from '#lib/content/schemas.ts';
import { parseContent } from '#lib/server/content/index.ts';

/** Limits of `#lib/content/schemas.ts` that are literals there (kept in sync by schemas.test.ts). */
export const LIMITS = {
	timer: { min: 5, max: 600, default: 30 },
	list: { max: 200, default: 50 },
	query: 200,
	url: 2000,
	playlistLocations: 500,
	/** MCP-only: items per `create_locations` call (each may download a photo, up to 15 s). */
	batch: 25,
	/** MCP-only: page size of `find_missing_translations`. */
	missing: { max: 100, default: 20 }
} as const;

/** Any well-formed uuid, like valibot's `v.uuid()` (no version/variant check). */
const uuid = (description: string) => z.guid().describe(description);
const locationId = (extra = '') =>
	uuid(`Location id (uuid) as returned by list_locations, create_location or get_playlist.${extra}`);
const playlistId = () => uuid('Playlist id (uuid) as returned by list_playlists or create_playlist.');

const text = (max: number, description: string) =>
	z.string().trim().max(max).nullish().describe(description);
const patchText = (max: number, description: string) =>
	text(max, `${description} Omit to keep the current value; null or "" clears it.`);

const TEXT_DESCRIPTIONS = {
	nameSv: 'Name in Swedish (e.g. "Eiffeltornet"). Shown to players only at the reveal.',
	nameEn: 'Name in English (e.g. "Eiffel Tower"). Shown to players only at the reveal.',
	clueTextSv:
		'Clue text in Swedish, shown to players DURING the round. Must not give away the name; optional if the location has a photo.',
	clueTextEn:
		'Clue text in English, shown to players DURING the round. Must not give away the name; optional if the location has a photo.',
	factSv: 'Optional fun fact in Swedish (1-3 sentences), shown at the reveal.',
	factEn: 'Optional fun fact in English (1-3 sentences), shown at the reveal.'
} as const;

export const LOCATION_TEXT_FIELDS = ['nameSv', 'nameEn', 'clueTextSv', 'clueTextEn', 'factSv', 'factEn'] as const;
type LocationTextField = (typeof LOCATION_TEXT_FIELDS)[number];

const TEXT_LIMIT: Record<LocationTextField, number> = {
	nameSv: TEXT_MAX.name,
	nameEn: TEXT_MAX.name,
	clueTextSv: TEXT_MAX.clue,
	clueTextEn: TEXT_MAX.clue,
	factSv: TEXT_MAX.fact,
	factEn: TEXT_MAX.fact
};

const locationTexts = (patch: boolean) =>
	Object.fromEntries(
		LOCATION_TEXT_FIELDS.map((f) => [f, (patch ? patchText : text)(TEXT_LIMIT[f], TEXT_DESCRIPTIONS[f])])
	) as Record<LocationTextField, ReturnType<typeof text>>;

const lat = z
	.number()
	.min(-MAX_LOCATION_LAT)
	.max(MAX_LOCATION_LAT)
	.describe(
		`Latitude in decimal degrees (WGS84, north positive) of the PRECISE answer point, e.g. 48.85837. Between -${MAX_LOCATION_LAT} and ${MAX_LOCATION_LAT}: the game map cannot show the poles.`
	);
const lng = z
	.number()
	.min(-180)
	.max(180)
	.describe('Longitude in decimal degrees (WGS84, east positive) of the PRECISE answer point, e.g. 2.294481.');

export const StartViewArg = z
	.strictObject({
		lat: z
			.number()
			.min(-MAX_LOCATION_LAT)
			.max(MAX_LOCATION_LAT)
			.describe(`Latitude of the map centre, between -${MAX_LOCATION_LAT} and ${MAX_LOCATION_LAT}.`),
		lng: z.number().min(-180).max(180).describe('Longitude of the map centre.'),
		zoom: z
			.number()
			.min(MIN_ZOOM)
			.max(MAX_ZOOM)
			.describe(`Map zoom, ${MIN_ZOOM}-${MAX_ZOOM} (about 1.2 shows the whole world, 4-5 a country).`)
	})
	.describe(
		"Optional start view: where the players' guess maps open during the round instead of the whole world. It is a hint, so frame a region (e.g. the country) rather than centring it on the answer point."
	);

const httpUrl = z.url({ protocol: /^https?$/ }).max(LIMITS.url);

const photoMeta = {
	attribution: text(
		TEXT_MAX.attribution,
		'Credit line for the image: author and license, e.g. "Photo: Jane Doe, CC BY-SA 4.0". Fill this in whenever the license requires attribution.'
	),
	sourceUrl: httpUrl
		.nullish()
		.describe('Page the image came from (e.g. the Wikimedia Commons file page). Defaults to the image URL.')
};
const imageUrl = httpUrl.describe(
	'Direct http(s) URL of the image file itself (JPEG, PNG, WebP, GIF, AVIF or TIFF, max 15 MB), not an HTML page. The server downloads it once; nothing is hotlinked.'
);

export const PhotoArg = z
	.strictObject({ url: imageUrl, ...photoMeta })
	.describe('Optional clue photo, downloaded from a URL. The photo must not show the name (signs, captions, watermarks).');

// ---------------------------------------------------------------------------------------------
// Tool inputs
// ---------------------------------------------------------------------------------------------

export const ListLocationsArgs = z.strictObject({
	query: z
		.string()
		.trim()
		.max(LIMITS.query)
		.optional()
		.describe(
			'Free-text search over names, clue texts and facts in both languages; every word must match. Omit to list all.'
		),
	limit: z
		.int()
		.min(1)
		.max(LIMITS.list.max)
		.optional()
		.describe(`Page size, 1-${LIMITS.list.max} (default ${LIMITS.list.default}).`),
	offset: z.int().min(0).optional().describe('Items to skip (default 0). Use nextOffset from the previous page.')
});

export const IdArgs = (what: 'location' | 'playlist') =>
	z.strictObject({ id: what === 'location' ? locationId() : playlistId() });

export const CreateLocationArgs = z.strictObject({
	...locationTexts(false),
	lat,
	lng,
	startView: StartViewArg.nullish().describe(`${StartViewArg.description} Omit or null for none.`),
	photo: PhotoArg.optional()
});

export const CreateLocationsArgs = z.strictObject({
	locations: z
		.array(CreateLocationArgs)
		.min(1)
		.max(LIMITS.batch)
		.describe(
			`1-${LIMITS.batch} locations, each with the same fields as create_location. Each item is created on its own (not all-or-nothing); the result reports success or the error per item index.`
		)
});

export const UpdateLocationArgs = z.strictObject({
	id: locationId(),
	...locationTexts(true),
	lat: lat.optional(),
	lng: lng.optional(),
	startView: StartViewArg.nullish().describe(
		`${StartViewArg.description} Omit to keep the current value; null removes it.`
	)
});

export const ListPlaylistsArgs = z.strictObject({
	query: z
		.string()
		.trim()
		.max(LIMITS.query)
		.optional()
		.describe('Case-insensitive filter on the playlist name (either language). Omit to list all.')
});

const timer = z
	.int()
	.min(LIMITS.timer.min)
	.max(LIMITS.timer.max)
	.describe(
		`Default seconds per round when a game is created from this playlist, ${LIMITS.timer.min}-${LIMITS.timer.max} (typically 30-60).`
	);
const playlistNames = (patch: boolean) => ({
	nameSv: (patch ? patchText : text)(TEXT_MAX.name, 'Playlist name in Swedish (e.g. "Europas huvudstäder").'),
	nameEn: (patch ? patchText : text)(TEXT_MAX.name, 'Playlist name in English (e.g. "European capitals").')
});
const locationIdList = (description: string, min = 0) =>
	z.array(locationId()).min(min).max(LIMITS.playlistLocations).describe(description);

export const CreatePlaylistArgs = z.strictObject({
	...playlistNames(false),
	defaultTimerSeconds: timer.optional().describe(`${timer.description} Default ${LIMITS.timer.default}.`),
	locationIds: locationIdList('Optional initial locations, in play order (no duplicates).').optional()
});

export const UpdatePlaylistArgs = z.strictObject({
	id: playlistId(),
	...playlistNames(true),
	defaultTimerSeconds: timer.optional().describe(`${timer.description} Omit to keep the current value.`)
});

export const SetPlaylistLocationsArgs = z.strictObject({
	playlistId: playlistId(),
	locationIds: locationIdList(
		'The COMPLETE new list of locations in play order (no duplicates). Replaces the current list; [] empties the playlist.'
	)
});

export const AddLocationsToPlaylistArgs = z.strictObject({
	playlistId: playlistId(),
	locationIds: locationIdList(
		'Locations to add, in this order. Ids already in the playlist are skipped (not moved).',
		1
	),
	position: z
		.int()
		.min(0)
		.optional()
		.describe('0-based index to insert at (0 = first). Omit to append at the end.')
});

export const RemoveLocationsFromPlaylistArgs = z.strictObject({
	playlistId: playlistId(),
	locationIds: locationIdList('Locations to remove from this playlist (the locations themselves are kept).', 1)
});

export const AttachPhotoArgs = z.strictObject({
	locationId: locationId(),
	url: imageUrl,
	...photoMeta
});

export const RemovePhotoArgs = z.strictObject({ locationId: locationId() });

export const FindMissingTranslationsArgs = z.strictObject({
	language: z
		.enum(['sv', 'en'])
		.optional()
		.describe('Only report texts that lack this language. Omit for both.'),
	playlistId: playlistId().optional().describe('Only check the locations of this playlist.'),
	limit: z
		.int()
		.min(1)
		.max(LIMITS.missing.max)
		.optional()
		.describe(`Locations per page, 1-${LIMITS.missing.max} (default ${LIMITS.missing.default}).`),
	offset: z.int().min(0).optional().describe('Locations to skip (default 0).')
});

export type CreateLocationArgs = z.infer<typeof CreateLocationArgs>;
export type UpdateLocationArgs = z.infer<typeof UpdateLocationArgs>;

// ---------------------------------------------------------------------------------------------
// Conversion to the shared valibot schemas (authoritative validation)
// ---------------------------------------------------------------------------------------------

/** null / undefined → '' (valibot inputs never accept null; '' means "empty"). */
const str = (s: string | null | undefined) => s ?? '';

/** A syntactically valid uuid used only to pre-validate a create before a photo exists. */
export const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

export function toLocationInput(args: CreateLocationArgs, photoId: string | null): LocationInput {
	return parseContent(LocationInputSchema, {
		...Object.fromEntries(LOCATION_TEXT_FIELDS.map((f) => [f, str(args[f])])),
		lat: args.lat,
		lng: args.lng,
		photoId: photoId ?? '',
		...(args.startView
			? { startLat: args.startView.lat, startLng: args.startView.lng, startZoom: args.startView.zoom }
			: {})
	});
}

export function toLocationPatch(args: UpdateLocationArgs): LocationPatch {
	const raw: Record<string, unknown> = { id: args.id };
	for (const f of LOCATION_TEXT_FIELDS) if (args[f] !== undefined) raw[f] = str(args[f]);
	if (args.lat !== undefined) raw.lat = args.lat;
	if (args.lng !== undefined) raw.lng = args.lng;
	if (args.startView === null) raw.clearStartView = true;
	else if (args.startView) {
		raw.startLat = args.startView.lat;
		raw.startLng = args.startView.lng;
		raw.startZoom = args.startView.zoom;
	}
	return parseContent(LocationPatchSchema, raw);
}

export function toListQuery(args: z.infer<typeof ListLocationsArgs>): ListQuery {
	return parseContent(ListQuerySchema, {
		query: args.query,
		limit: args.limit ?? LIMITS.list.default,
		offset: args.offset ?? 0
	});
}

export function toPlaylistInput(args: z.infer<typeof CreatePlaylistArgs>): PlaylistInput {
	return parseContent(PlaylistInputSchema, {
		nameSv: str(args.nameSv),
		nameEn: str(args.nameEn),
		defaultTimerSeconds: args.defaultTimerSeconds ?? LIMITS.timer.default
	});
}

export function toPlaylistPatch(args: z.infer<typeof UpdatePlaylistArgs>): PlaylistPatch {
	const raw: Record<string, unknown> = { id: args.id };
	if (args.nameSv !== undefined) raw.nameSv = str(args.nameSv);
	if (args.nameEn !== undefined) raw.nameEn = str(args.nameEn);
	if (args.defaultTimerSeconds !== undefined) raw.defaultTimerSeconds = args.defaultTimerSeconds;
	return parseContent(PlaylistPatchSchema, raw);
}

export function toPlaylistItems(playlistId: string, locationIds: string[]): SetPlaylistItemsInput {
	return parseContent(SetPlaylistItemsSchema, { playlistId, locationIds });
}

export function toPhotoImport(
	args: { url: string; attribution?: string | null; sourceUrl?: string | null },
	locationId?: string
): ImportPhotoInput {
	return parseContent(ImportPhotoSchema, {
		url: args.url,
		attribution: str(args.attribution),
		sourceUrl: str(args.sourceUrl),
		...(locationId ? { locationId } : {})
	});
}

// ---------------------------------------------------------------------------------------------
// Tool outputs (structuredContent)
// ---------------------------------------------------------------------------------------------

const nullableText = z.string().nullable();
const langs = z.array(z.enum(['sv', 'en']));

export const MissingOut = z
	.object({ name: langs, clueText: langs, fact: langs })
	.describe('Per text: the language still to write ([] = complete, or the optional text is unused).');

export const PhotoOut = z.object({
	id: z.string(),
	url: z.string().describe('URL of the stored 1024 px WebP version.'),
	width: z.number(),
	height: z.number(),
	attribution: nullableText,
	sourceUrl: nullableText
});

export const LocationOut = z.object({
	id: z.string(),
	nameSv: nullableText,
	nameEn: nullableText,
	clueTextSv: nullableText,
	clueTextEn: nullableText,
	factSv: nullableText,
	factEn: nullableText,
	lat: z.number(),
	lng: z.number(),
	startView: z
		.object({ lat: z.number(), lng: z.number(), zoom: z.number() })
		.nullable()
		.describe("Where the players' guess maps open, or null for the whole world."),
	photo: PhotoOut.nullable(),
	missingTranslations: MissingOut,
	updatedAt: z.string()
});

export const LocationSummaryOut = z.object({
	id: z.string(),
	nameSv: nullableText,
	nameEn: nullableText,
	lat: z.number(),
	lng: z.number(),
	hasPhoto: z.boolean(),
	hasClueText: z.boolean(),
	missingTranslations: MissingOut,
	playlistCount: z.number().optional().describe('Number of playlists the location is in.')
});

export const PlaylistSummaryOut = z.object({
	id: z.string(),
	nameSv: nullableText,
	nameEn: nullableText,
	defaultTimerSeconds: z.number(),
	locationCount: z.number(),
	missingTranslationCount: z.number().describe('Locations in the playlist with a missing translation.'),
	updatedAt: z.string()
});

export const PlaylistOut = z.object({
	id: z.string(),
	nameSv: nullableText,
	nameEn: nullableText,
	defaultTimerSeconds: z.number(),
	locationCount: z.number(),
	locations: z.array(LocationSummaryOut.extend({ position: z.number().describe('0-based play order.') }))
});

const page = <T extends z.ZodType>(item: T) =>
	z.object({
		total: z.number(),
		offset: z.number(),
		limit: z.number(),
		nextOffset: z.number().nullable().describe('Offset of the next page, or null on the last page.'),
		items: z.array(item)
	});

export const ListLocationsOut = page(LocationSummaryOut);
export const GetLocationOut = z.object({
	location: LocationOut,
	usage: z.object({
		playlists: z.number().describe('Playlists containing the location.'),
		games: z.number().describe('Games it was played in (if > 0 it cannot be deleted).')
	})
});
export const LocationResultOut = z.object({ location: LocationOut });
export const CreateLocationsOut = z.object({
	created: z.number(),
	failed: z.number(),
	results: z.array(
		z.object({
			index: z.number().describe('Index of the item in the request.'),
			ok: z.boolean(),
			location: LocationSummaryOut.optional(),
			error: z.string().optional().describe('Why this item failed (fix it and send it again).')
		})
	)
});
export const DeletedOut = z.object({ deleted: z.literal(true), id: z.string() });
export const DeleteLocationOut = DeletedOut.extend({
	removedFromPlaylists: z.number().describe('Playlists the location was removed from.')
});
export const ListPlaylistsOut = z.object({ items: z.array(PlaylistSummaryOut) });
export const PlaylistResultOut = z.object({ playlist: PlaylistOut });
export const AddLocationsOut = PlaylistResultOut.extend({
	added: z.array(z.string()),
	alreadyInPlaylist: z.array(z.string())
});
export const RemoveLocationsOut = PlaylistResultOut.extend({
	removed: z.array(z.string()),
	notInPlaylist: z.array(z.string())
});

const TranslateOut = z.object({
	field: z.string().describe('Field to fill in, e.g. "nameEn".'),
	from: z.string().describe('Field that has the text, e.g. "nameSv".'),
	text: z.string().describe('The existing text to translate.')
});
export const FindMissingOut = z.object({
	locations: page(
		z.object({
			id: z.string(),
			nameSv: nullableText,
			nameEn: nullableText,
			toTranslate: z.array(TranslateOut)
		})
	),
	playlists: z
		.array(PlaylistSummaryOut.pick({ id: true, nameSv: true, nameEn: true, locationCount: true, missingTranslationCount: true }))
		.optional()
		.describe('Playlists with locations that need translating (only when no playlistId is given).'),
	playlistNamesToTranslate: z
		.array(z.object({ id: z.string(), toTranslate: z.array(TranslateOut) }))
		.describe('Playlists whose own name lacks a language.')
});
