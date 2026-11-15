/**
 * Admin content remote functions. STUB (Wave 0): exported names, schemas and output types are
 * final; bodies are implemented in Wave 1 (content agent) on top of `#lib/server/content/`.
 * Every function starts with `requireAdmin()`. Forms return the saved row (no redirect) unless
 * noted, so the UI can stay on the page.
 */
import { error } from '@sveltejs/kit';
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
import type { Location, Photo, Playlist } from '#lib/server/db/schema.ts';
import type {
	LocationListItem,
	LocationWithPhoto,
	PlaylistSummary,
	PlaylistWithItems
} from '#lib/server/content/index.ts';

function notImplemented(name: string): never {
	error(501, `Not implemented: ${name}`);
}

const Uuid = v.pipe(v.string(), v.uuid());

// --- Locations -----------------------------------------------------------------------------------

export const listLocations = query(
	ListQuerySchema,
	async (q): Promise<{ items: LocationListItem[]; total: number }> => {
		notImplemented(`listLocations(${q.query ?? ''})`);
	}
);

export const getLocation = query(Uuid, async (id): Promise<LocationWithPhoto | null> => {
	notImplemented(`getLocation(${id})`);
});

export const createLocation = form(LocationInputSchema, async (data): Promise<Location> => {
	notImplemented(`createLocation(${data.lat})`);
});

/** Use `updateLocation.for(id)` per row. */
export const updateLocation = form(LocationPatchSchema, async (data): Promise<Location> => {
	notImplemented(`updateLocation(${data.id})`);
});

export const deleteLocation = command(IdSchema, async ({ id }): Promise<void> => {
	notImplemented(`deleteLocation(${id})`);
});

// --- Playlists -----------------------------------------------------------------------------------

export const listPlaylists = query(async (): Promise<PlaylistSummary[]> => {
	notImplemented('listPlaylists');
});

export const getPlaylist = query(Uuid, async (id): Promise<PlaylistWithItems | null> => {
	notImplemented(`getPlaylist(${id})`);
});

export const createPlaylist = form(PlaylistInputSchema, async (data): Promise<Playlist> => {
	notImplemented(`createPlaylist(${data.defaultTimerSeconds})`);
});

export const updatePlaylist = form(PlaylistPatchSchema, async (data): Promise<Playlist> => {
	notImplemented(`updatePlaylist(${data.id})`);
});

export const deletePlaylist = command(IdSchema, async ({ id }): Promise<void> => {
	notImplemented(`deletePlaylist(${id})`);
});

export const setPlaylistItems = command(SetPlaylistItemsSchema, async (input): Promise<void> => {
	notImplemented(`setPlaylistItems(${input.playlistId})`);
});

// --- Photos --------------------------------------------------------------------------------------

/** Multipart form: `<form {...uploadPhoto} enctype="multipart/form-data">`. */
export const uploadPhoto = form(UploadPhotoSchema, async (data): Promise<Photo> => {
	notImplemented(`uploadPhoto(${data.file.name})`);
});

export const importPhoto = form(ImportPhotoSchema, async (data): Promise<Photo> => {
	notImplemented(`importPhoto(${data.url})`);
});

export const attachPhoto = command(AttachPhotoSchema, async (input): Promise<void> => {
	notImplemented(`attachPhoto(${input.locationId})`);
});

export const deletePhoto = command(IdSchema, async ({ id }): Promise<void> => {
	notImplemented(`deletePhoto(${id})`);
});
