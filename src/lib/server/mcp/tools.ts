/**
 * MCP tools over `#lib/server/content/` (content management only; no game control).
 *
 * Every handler: zod-parsed args (SDK) → `to*` conversion in `schemas.ts` (shared valibot
 * validation) → content service → concise view (`views.ts`) returned as `structuredContent`
 * plus the same JSON as text. Failures never escape a handler: `ContentError`s become tool
 * errors (`isError: true`) with an actionable message; anything else is logged and reported
 * generically, so internals never reach the client.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import {
	attachPhoto,
	ContentError,
	createLocation,
	createPlaylist,
	deleteLocation,
	deletePhoto,
	deletePlaylist,
	getLocation,
	getPlaylist,
	importPhotoFromUrl,
	listLocations,
	listPlaylists,
	locationUsage,
	setPlaylistItems,
	translationGap,
	updateLocation,
	updatePlaylist,
	type ContentErrorCode,
	type LocationWithPhoto
} from '#lib/server/content/index.ts';
import type { Location, Photo } from '#lib/server/db/schema.ts';
import * as S from './schemas.ts';
import { locationOut, locationSummary, playlistOut, playlistSummary, type ViewContext } from './views.ts';

type Hints = Partial<Record<ContentErrorCode, string>>;

const GENERIC_HINTS: Record<ContentErrorCode, string> = {
	INVALID: 'Correct the input named above and call the tool again.',
	NOT_FOUND: 'Check the id: use list_locations, list_playlists or get_playlist to look up current ids.',
	IN_USE: 'It is kept as is.',
	IMPORT_FAILED:
		'Use a direct, publicly reachable http(s) link to the image file itself (JPEG, PNG, WebP, GIF, AVIF or TIFF, at most 15 MB), e.g. an upload.wikimedia.org URL, not an HTML page; or try another image.'
};

const LABEL: Record<ContentErrorCode, string> = {
	INVALID: 'Invalid input',
	NOT_FOUND: 'Not found',
	IN_USE: 'Refused',
	IMPORT_FAILED: 'Photo import failed'
};

/** Message for a failed call (or batch item). Unexpected errors are logged, never echoed. */
export function errorMessage(tool: string, e: unknown, hints: Hints = {}): string {
	if (e instanceof ContentError) {
		const detail = e.message.replace(/\.?\s*$/, '.');
		return `${LABEL[e.code]}: ${detail} ${hints[e.code] ?? GENERIC_HINTS[e.code]}`;
	}
	console.error(`[mcp] ${tool} failed`, e);
	return `Internal error in ${tool}. This was not caused by your input; retry once, and if it fails again report it to the owner.`;
}

const notFound = (what: 'Location' | 'Playlist'): never => {
	throw new ContentError('NOT_FOUND', `${what} not found`);
};

interface ToolDef<I extends z.ZodObject, O extends z.ZodObject> {
	title: string;
	description: string;
	input: I;
	output: O;
	annotations: Omit<ToolAnnotations, 'title'>;
	hints?: Hints;
	run: (args: z.infer<I>) => Promise<z.infer<O>>;
}

function register<I extends z.ZodObject, O extends z.ZodObject>(
	server: McpServer,
	name: string,
	def: ToolDef<I, O>
): void {
	const handler = async (args: z.infer<I>): Promise<CallToolResult> => {
		try {
			const out = (await def.run(args)) as Record<string, unknown>;
			return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
		} catch (e) {
			return { content: [{ type: 'text', text: errorMessage(name, e, def.hints) }], isError: true };
		}
	};
	server.registerTool(
		name,
		{
			title: def.title,
			description: def.description,
			inputSchema: def.input,
			outputSchema: def.output,
			annotations: { title: def.title, ...def.annotations }
		},
		// The SDK's callback type is generic over its own zod-compat layer; `handler` is typed on z.infer.
		handler as never
	);
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/** Every location (paged through the content service), deduplicated by id. */
async function allLocations(): Promise<Location[]> {
	const byId = new Map<string, Location>();
	for (let offset = 0; ; offset += S.LIMITS.list.max) {
		const { items, total } = await listLocations({ limit: S.LIMITS.list.max, offset });
		for (const l of items) byId.set(l.id, l);
		if (items.length === 0 || offset + items.length >= total) break;
	}
	return [...byId.values()];
}

type Pair = 'name' | 'clueText' | 'fact';
function toTranslate(row: Record<`${Pair}${'Sv' | 'En'}`, string | null>, language?: 'sv' | 'en') {
	const out: Array<{ field: string; from: string; text: string }> = [];
	for (const pair of ['name', 'clueText', 'fact'] as const) {
		const sv = row[`${pair}Sv`];
		const en = row[`${pair}En`];
		for (const missing of translationGap(sv, en)) {
			if (language && missing !== language) continue;
			out.push(
				missing === 'en'
					? { field: `${pair}En`, from: `${pair}Sv`, text: sv! }
					: { field: `${pair}Sv`, from: `${pair}En`, text: en! }
			);
		}
	}
	return out;
}

export function registerTools(server: McpServer, ctx: ViewContext): void {
	const fullLocation = async (id: string) => {
		const l: LocationWithPhoto = (await getLocation(id)) ?? notFound('Location');
		return locationOut(l, l.photo, ctx);
	};
	const fullPlaylist = async (id: string) => playlistOut((await getPlaylist(id)) ?? notFound('Playlist'));

	/** Creates one location, importing its photo first when given (removed again on failure). */
	const createOne = async (args: S.CreateLocationArgs): Promise<{ row: Location; photo: Photo | null }> => {
		if (!args.photo) return { row: await createLocation(S.toLocationInput(args, null)), photo: null };
		S.toLocationInput(args, S.PLACEHOLDER_ID); // validate everything before downloading
		const photo = await importPhotoFromUrl(S.toPhotoImport(args.photo));
		try {
			return { row: await createLocation(S.toLocationInput(args, photo.id)), photo };
		} catch (e) {
			await deletePhoto(photo.id).catch(() => {});
			throw e;
		}
	};

	// --- Locations -----------------------------------------------------------------------------

	register(server, 'list_locations', {
		title: 'List or search locations',
		description:
			'Lists locations, newest edited first, optionally filtered by a free-text search over names, clue texts and facts in both languages. Returns compact summaries (id, names, coordinates, whether it has a photo / clue text, missing translations, playlist count) and pagination info; use get_location for all texts.',
		input: S.ListLocationsArgs,
		output: S.ListLocationsOut,
		annotations: READ_ONLY,
		run: async (args) => {
			const q = S.toListQuery(args);
			const { items, total } = await listLocations(q);
			const end = q.offset + items.length;
			return {
				total,
				offset: q.offset,
				limit: q.limit,
				nextOffset: end < total && items.length > 0 ? end : null,
				items: items.map(locationSummary)
			};
		}
	});

	register(server, 'get_location', {
		title: 'Get a location',
		description:
			'Returns one location with all texts in both languages, coordinates, photo (URL, attribution, source), missing translations, and usage (how many playlists contain it and how many games it was played in).',
		input: S.IdArgs('location'),
		output: S.GetLocationOut,
		annotations: READ_ONLY,
		run: async ({ id }) => ({ location: await fullLocation(id), usage: await locationUsage(id) })
	});

	register(server, 'create_location', {
		title: 'Create a location',
		description:
			'Creates one location. Required: lat/lng (the precise answer point), a name in at least one language, and a clue (clueTextSv/clueTextEn and/or photo). Write both Swedish and English whenever you can. The optional photo is downloaded from its URL and stored. Returns the new location with its id. To create several, use create_locations.',
		input: S.CreateLocationArgs,
		output: S.LocationResultOut,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		run: async (args) => {
			const { row, photo } = await createOne(args);
			return { location: locationOut(row, photo, ctx) };
		}
	});

	register(server, 'create_locations', {
		title: 'Create several locations',
		description: `Creates up to ${S.LIMITS.batch} locations in one call (same fields per item as create_location). Items are created one by one, so some may succeed while others fail; the result lists, per request index, the created location's id or the error. Resend only the failed items after fixing them.`,
		input: S.CreateLocationsArgs,
		output: S.CreateLocationsOut,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
		run: async ({ locations }) => {
			const results: z.infer<typeof S.CreateLocationsOut>['results'] = [];
			for (const [index, item] of locations.entries()) {
				try {
					const { row } = await createOne(item);
					results.push({ index, ok: true, location: locationSummary(row) });
				} catch (e) {
					results.push({ index, ok: false, error: errorMessage('create_locations', e) });
				}
			}
			const created = results.filter((r) => r.ok).length;
			return { created, failed: results.length - created, results };
		}
	});

	register(server, 'update_location', {
		title: 'Update a location',
		description:
			'Changes only the fields you send (e.g. add a translation, fix coordinates); omitted fields keep their value, null or "" clears a text. The location must still have a name and a clue afterwards. Use attach_photo_from_url / remove_photo for the photo. Returns the updated location.',
		input: S.UpdateLocationArgs,
		output: S.LocationResultOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		run: async (args) => {
			const patch = S.toLocationPatch(args);
			if (Object.keys(patch).every((k) => k === 'id' || patch[k as keyof typeof patch] === undefined)) {
				throw new ContentError('INVALID', 'Nothing to update: send at least one field besides id');
			}
			const row = await updateLocation(patch);
			return { location: await fullLocation(row.id) };
		}
	});

	register(server, 'delete_location', {
		title: 'Delete a location',
		description:
			'Permanently deletes a location and removes it from every playlist. Refused if it has been played in a game (the game history keeps it); in that case remove it from playlists instead.',
		input: S.IdArgs('location'),
		output: S.DeleteLocationOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		hints: {
			IN_USE: 'It cannot be deleted. To stop using it, remove it from its playlists with remove_locations_from_playlist.'
		},
		run: async ({ id }) => {
			const usage = await locationUsage(id);
			await deleteLocation(id);
			return { deleted: true as const, id, removedFromPlaylists: usage.playlists };
		}
	});

	// --- Photos --------------------------------------------------------------------------------

	register(server, 'attach_photo_from_url', {
		title: 'Attach a photo from a URL',
		description:
			'Downloads an image from a URL, strips its metadata, stores it and sets it as the clue photo of a location, replacing (and deleting) any previous photo. Use a direct image link whose license allows reuse and give attribution (author, license) and sourceUrl (the page describing the image). The photo must not show the place name. Returns the updated location.',
		input: S.AttachPhotoArgs,
		output: S.LocationResultOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
		run: async (args) => {
			await importPhotoFromUrl(S.toPhotoImport(args, args.locationId));
			return { location: await fullLocation(args.locationId) };
		}
	});

	register(server, 'remove_photo', {
		title: 'Remove the photo of a location',
		description:
			'Removes the clue photo from a location (the stored image is deleted when no other location uses it). Refused when the photo is the only clue; add a clue text with update_location first. Returns the updated location.',
		input: S.RemovePhotoArgs,
		output: S.LocationResultOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		hints: { INVALID: 'Nothing was changed.' },
		run: async ({ locationId }) => {
			const l = (await getLocation(locationId)) ?? notFound('Location');
			if (l.photoId) await attachPhoto(l.id, null);
			return { location: await fullLocation(l.id) };
		}
	});

	// --- Playlists -----------------------------------------------------------------------------

	register(server, 'list_playlists', {
		title: 'List playlists',
		description:
			'Lists all playlists, newest edited first, with their default timer, number of locations and how many of those locations miss a translation. Use get_playlist for the locations in order.',
		input: S.ListPlaylistsArgs,
		output: S.ListPlaylistsOut,
		annotations: READ_ONLY,
		run: async ({ query }) => {
			const q = query?.toLocaleLowerCase();
			const all = await listPlaylists();
			const items = q
				? all.filter((p) => `${p.nameSv ?? ''}\n${p.nameEn ?? ''}`.toLocaleLowerCase().includes(q))
				: all;
			return { items: items.map(playlistSummary) };
		}
	});

	register(server, 'get_playlist', {
		title: 'Get a playlist',
		description:
			'Returns a playlist with its locations in play order (compact summaries: id, names, coordinates, photo / clue text present, missing translations).',
		input: S.IdArgs('playlist'),
		output: S.PlaylistResultOut,
		annotations: READ_ONLY,
		run: async ({ id }) => ({ playlist: await fullPlaylist(id) })
	});

	register(server, 'create_playlist', {
		title: 'Create a playlist',
		description: `Creates a playlist with a name (at least one language, preferably both) and a default round timer (default ${S.LIMITS.timer.default} s). Optionally pass locationIds to fill it in play order in the same call. Returns the playlist with its id.`,
		input: S.CreatePlaylistArgs,
		output: S.PlaylistResultOut,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
		hints: { INVALID: 'Nothing was created. Correct the input named above and call the tool again.' },
		run: async (args) => {
			const input = S.toPlaylistInput(args);
			const ids = args.locationIds ?? [];
			if (ids.length) S.toPlaylistItems(S.PLACEHOLDER_ID, ids); // duplicates etc. before creating
			const created = await createPlaylist(input);
			if (ids.length) {
				try {
					await setPlaylistItems(S.toPlaylistItems(created.id, ids));
				} catch (e) {
					await deletePlaylist(created.id).catch(() => {});
					throw e;
				}
			}
			return { playlist: await fullPlaylist(created.id) };
		}
	});

	register(server, 'update_playlist', {
		title: 'Update a playlist',
		description:
			'Changes a playlist\'s names and/or default timer; omitted fields keep their value, null or "" clears a name (one must remain). Use set_playlist_locations / add_locations_to_playlist / remove_locations_from_playlist for its locations.',
		input: S.UpdatePlaylistArgs,
		output: S.PlaylistResultOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		run: async (args) => {
			const patch = S.toPlaylistPatch(args);
			if (patch.nameSv === undefined && patch.nameEn === undefined && patch.defaultTimerSeconds === undefined) {
				throw new ContentError('INVALID', 'Nothing to update: send at least one field besides id');
			}
			const row = await updatePlaylist(patch);
			return { playlist: await fullPlaylist(row.id) };
		}
	});

	register(server, 'delete_playlist', {
		title: 'Delete a playlist',
		description:
			'Permanently deletes a playlist. Its locations are kept in the library; finished games keep their history.',
		input: S.IdArgs('playlist'),
		output: S.DeletedOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		run: async ({ id }) => {
			await deletePlaylist(id);
			return { deleted: true as const, id };
		}
	});

	register(server, 'set_playlist_locations', {
		title: 'Set the locations of a playlist',
		description:
			'Replaces the whole ordered list of locations of a playlist in one atomic step (use it to reorder, too). Send the complete list in play order; locations left out are removed from the playlist (not deleted). Returns the playlist.',
		input: S.SetPlaylistLocationsArgs,
		output: S.PlaylistResultOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		hints: { INVALID: 'The playlist was not changed. Correct the list and call the tool again.' },
		run: async ({ playlistId, locationIds }) => {
			await setPlaylistItems(S.toPlaylistItems(playlistId, locationIds));
			return { playlist: await fullPlaylist(playlistId) };
		}
	});

	register(server, 'add_locations_to_playlist', {
		title: 'Add locations to a playlist',
		description:
			'Adds locations to a playlist, at the end or at a 0-based position, keeping the order you give. Locations already in the playlist are skipped and reported (not moved). Returns the playlist and what was added.',
		input: S.AddLocationsToPlaylistArgs,
		output: S.AddLocationsOut,
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		hints: { INVALID: 'The playlist was not changed. Correct the list and call the tool again.' },
		run: async ({ playlistId, locationIds, position }) => {
			const p = (await getPlaylist(playlistId)) ?? notFound('Playlist');
			const current = p.items.map((i) => i.location.id);
			const present = new Set(current);
			const requested = [...new Set(locationIds)];
			const added = requested.filter((id) => !present.has(id));
			const alreadyInPlaylist = requested.filter((id) => present.has(id));
			if (added.length) {
				const at = Math.min(position ?? current.length, current.length);
				const next = [...current.slice(0, at), ...added, ...current.slice(at)];
				await setPlaylistItems(S.toPlaylistItems(p.id, next));
			}
			return { playlist: await fullPlaylist(p.id), added, alreadyInPlaylist };
		}
	});

	register(server, 'remove_locations_from_playlist', {
		title: 'Remove locations from a playlist',
		description:
			'Removes locations from a playlist (the locations themselves stay in the library). Ids that are not in the playlist are reported. Returns the playlist.',
		input: S.RemoveLocationsFromPlaylistArgs,
		output: S.RemoveLocationsOut,
		annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
		run: async ({ playlistId, locationIds }) => {
			const p = (await getPlaylist(playlistId)) ?? notFound('Playlist');
			const current = p.items.map((i) => i.location.id);
			const drop = new Set(locationIds);
			const removed = current.filter((id) => drop.has(id));
			const notInPlaylist = [...drop].filter((id) => !current.includes(id));
			if (removed.length) {
				await setPlaylistItems(S.toPlaylistItems(p.id, current.filter((id) => !drop.has(id))));
			}
			return { playlist: await fullPlaylist(p.id), removed, notInPlaylist };
		}
	});

	// --- Finding work --------------------------------------------------------------------------

	register(server, 'find_missing_translations', {
		title: 'Find missing translations',
		description:
			'Finds texts that exist in only one language: locations (name, clue text, fact) and playlist names, each with the field to fill in and the existing text to translate. Optionally restrict to one missing language or one playlist. Also lists playlists containing such locations. Fix them with update_location / update_playlist.',
		input: S.FindMissingTranslationsArgs,
		output: S.FindMissingOut,
		annotations: READ_ONLY,
		run: async ({ language, playlistId, limit = S.LIMITS.missing.default, offset = 0 }) => {
			const playlists = await listPlaylists();
			let locations: Location[];
			let scope = playlists;
			if (playlistId) {
				const p = (await getPlaylist(playlistId)) ?? notFound('Playlist');
				locations = p.items.map((i) => i.location);
				scope = playlists.filter((x) => x.id === p.id);
			} else {
				locations = await allLocations();
			}
			const gaps = locations
				.map((l) => ({ id: l.id, nameSv: l.nameSv, nameEn: l.nameEn, toTranslate: toTranslate(l, language) }))
				.filter((l) => l.toTranslate.length > 0);
			const items = gaps.slice(offset, offset + limit);
			const end = offset + items.length;
			return {
				locations: {
					total: gaps.length,
					offset,
					limit,
					nextOffset: end < gaps.length ? end : null,
					items
				},
				...(playlistId
					? {}
					: {
							playlists: playlists
								.filter((p) => p.missingTranslationCount > 0)
								.map(({ id, nameSv, nameEn, locationCount, missingTranslationCount }) => ({
									id,
									nameSv,
									nameEn,
									locationCount,
									missingTranslationCount
								}))
						}),
				playlistNamesToTranslate: scope
					.map((p) => ({
						id: p.id,
						toTranslate: toTranslate({ ...p, clueTextSv: null, clueTextEn: null, factSv: null, factEn: null }, language)
					}))
					.filter((p) => p.toTranslate.length > 0)
			};
		}
	});
}
