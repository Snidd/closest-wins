/**
 * Playlists: the ONLY module that reads or writes `playlist` / `playlist_item`.
 * STUB (Wave 0): signatures are final.
 */
import type {
	PlaylistInput,
	PlaylistPatch,
	SetPlaylistItemsInput
} from '#lib/content/schemas.ts';
import type { Playlist } from '#lib/server/db/schema.ts';
import type { LocationWithPhoto } from './locations.ts';
import { notImplemented } from '../not-implemented.ts';

export type PlaylistSummary = Playlist & {
	locationCount: number;
	/** Locations in the playlist missing a language in name, clue text or fact. */
	missingTranslationCount: number;
};

export type PlaylistWithItems = Playlist & {
	items: Array<{ position: number; location: LocationWithPhoto }>;
};

export async function listPlaylists(): Promise<PlaylistSummary[]> {
	return notImplemented('listPlaylists');
}

export async function getPlaylist(id: string): Promise<PlaylistWithItems | null> {
	return notImplemented('getPlaylist');
}

export async function createPlaylist(input: PlaylistInput): Promise<Playlist> {
	return notImplemented('createPlaylist');
}

export async function updatePlaylist(patch: PlaylistPatch): Promise<Playlist> {
	return notImplemented('updatePlaylist');
}

/** Games keep their rounds; `game.playlist_id` becomes null. */
export async function deletePlaylist(id: string): Promise<void> {
	return notImplemented('deletePlaylist');
}

/** Replaces all items with `locationIds` in order (positions 0..n-1), in one transaction. */
export async function setPlaylistItems(input: SetPlaylistItemsInput): Promise<void> {
	return notImplemented('setPlaylistItems');
}
