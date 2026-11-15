/**
 * Admin content remote functions on top of `#lib/server/content/`. Every function starts with
 * `requireAdmin()`. Forms return the saved row (no redirect) so the UI can stay on the page.
 *
 * `ContentError` mapping:
 * - forms: `INVALID` → form-level issue (`fields.allIssues()`), `IMPORT_FAILED` → issue on `url`,
 *   `NOT_FOUND` → HTTP 404;
 * - commands: HTTP error with the service's message — `INVALID` 400, `NOT_FOUND` 404,
 *   `IN_USE` 409, `IMPORT_FAILED` 422. On the client the rejection is an `HttpError`
 *   (`e.status`, `e.body.message`).
 */
import { error, invalid } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import * as v from 'valibot';
import {
	AttachPhotoSchema,
	IdSchema,
	ImportPhotoSchema,
	ListQuerySchema,
	LocationInputSchema,
	LocationPatchSchema,
	PlaylistInputSchema,
	PlaylistPatchSchema,
	SetPlaylistItemsSchema,
	UploadPhotoSchema
} from '#lib/content/schemas.ts';
import { requireAdmin } from '#lib/server/auth/index.ts';
import type { Location, Photo, Playlist } from '#lib/server/db/schema.ts';
import * as content from '#lib/server/content/index.ts';
import {
	ContentError,
	type LocationListItem,
	type LocationWithPhoto,
	type PlaylistSummary,
	type PlaylistWithItems
} from '#lib/server/content/index.ts';

const Uuid = v.pipe(v.string(), v.uuid());

const STATUS: Record<ContentError['code'], number> = {
	INVALID: 400,
	NOT_FOUND: 404,
	IN_USE: 409,
	IMPORT_FAILED: 422
};

/** Commands and queries: expected failures become HTTP errors with the service's message. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ContentError) error(STATUS[e.code], e.message);
		throw e;
	}
}

/** Forms: `INVALID` becomes a form-level validation issue, `NOT_FOUND` a 404. */
async function runForm<T>(fn: () => Promise<T>, onImportFailed?: (message: string) => never): Promise<T> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof ContentError) {
			if (e.code === 'INVALID' || e.code === 'IN_USE') invalid(e.message);
			if (e.code === 'IMPORT_FAILED') {
				if (onImportFailed) onImportFailed(e.message);
				invalid(e.message);
			}
			error(STATUS[e.code], e.message);
		}
		throw e;
	}
}

// --- Locations -----------------------------------------------------------------------------------

export const listLocations = query(
	ListQuerySchema,
	async (q): Promise<{ items: LocationListItem[]; total: number }> => {
		requireAdmin();
		return run(() => content.listLocations(q));
	}
);

export const getLocation = query(Uuid, async (id): Promise<LocationWithPhoto | null> => {
	requireAdmin();
	return run(() => content.getLocation(id));
});

export const createLocation = form(LocationInputSchema, async (data): Promise<Location> => {
	requireAdmin();
	return runForm(() => content.createLocation(data));
});

/** Use `updateLocation.for(id)` per row. */
export const updateLocation = form(LocationPatchSchema, async (data): Promise<Location> => {
	requireAdmin();
	const row = await runForm(() => content.updateLocation(data));
	// Single flight: the editor's query comes back with the response.
	void getLocation(data.id).refresh();
	return row;
});

export const deleteLocation = command(IdSchema, async ({ id }): Promise<void> => {
	requireAdmin();
	return run(() => content.deleteLocation(id));
});

// --- Playlists -----------------------------------------------------------------------------------

export const listPlaylists = query(async (): Promise<PlaylistSummary[]> => {
	requireAdmin();
	return run(() => content.listPlaylists());
});

export const getPlaylist = query(Uuid, async (id): Promise<PlaylistWithItems | null> => {
	requireAdmin();
	return run(() => content.getPlaylist(id));
});

export const createPlaylist = form(PlaylistInputSchema, async (data): Promise<Playlist> => {
	requireAdmin();
	return runForm(() => content.createPlaylist(data));
});

export const updatePlaylist = form(PlaylistPatchSchema, async (data): Promise<Playlist> => {
	requireAdmin();
	const row = await runForm(() => content.updatePlaylist(data));
	void getPlaylist(data.id).refresh();
	return row;
});

export const deletePlaylist = command(IdSchema, async ({ id }): Promise<void> => {
	requireAdmin();
	return run(() => content.deletePlaylist(id));
});

export const setPlaylistItems = command(SetPlaylistItemsSchema, async (input): Promise<void> => {
	requireAdmin();
	return run(() => content.setPlaylistItems(input));
});

// --- Photos --------------------------------------------------------------------------------------

/** Multipart form: `<form {...uploadPhoto} enctype="multipart/form-data">`. */
export const uploadPhoto = form(UploadPhotoSchema, async (data): Promise<Photo> => {
	requireAdmin();
	return runForm(() => content.uploadPhoto(data));
});

export const importPhoto = form(ImportPhotoSchema, async (data, issue): Promise<Photo> => {
	requireAdmin();
	return runForm(
		() => content.importPhotoFromUrl(data),
		(message) => invalid(issue.url(message))
	);
});

export const attachPhoto = command(AttachPhotoSchema, async (input): Promise<void> => {
	requireAdmin();
	return run(() => content.attachPhoto(input.locationId, input.photoId));
});

export const deletePhoto = command(IdSchema, async ({ id }): Promise<void> => {
	requireAdmin();
	return run(() => content.deletePhoto(id));
});
