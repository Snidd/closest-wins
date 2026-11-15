/**
 * Locations: the ONLY module that reads or writes the `location` table (admin remote functions
 * and MCP tools both go through here). STUB (Wave 0): signatures are final.
 * Validate input with the schemas in `#lib/content/schemas.ts`; throw `ContentError`.
 */
import type { Locale } from '#lib/i18n/locale.ts';
import type { LocationInput, LocationPatch, ListQuery } from '#lib/content/schemas.ts';
import type { Location, Photo } from '#lib/server/db/schema.ts';
import { notImplemented } from '../not-implemented.ts';

export type LocationWithPhoto = Location & { photo: Photo | null };

export type LocationListItem = LocationWithPhoto & {
	/** Languages missing per bilingual field (translation badges). */
	missing: { name: Locale[]; clueText: Locale[]; fact: Locale[] };
	playlistCount: number;
};

export async function listLocations(query: ListQuery): Promise<{ items: LocationListItem[]; total: number }> {
	return notImplemented('listLocations');
}

export async function getLocation(id: string): Promise<LocationWithPhoto | null> {
	return notImplemented('getLocation');
}

export async function createLocation(input: LocationInput): Promise<Location> {
	return notImplemented('createLocation');
}

/** Applies the patch; the merged row must still have a name and a photo or clue text. */
export async function updateLocation(patch: LocationPatch): Promise<Location> {
	return notImplemented('updateLocation');
}

/** Fails with `IN_USE` if the location was played in a game (game history keeps it). */
export async function deleteLocation(id: string): Promise<void> {
	return notImplemented('deleteLocation');
}

export async function locationUsage(id: string): Promise<{ playlists: number; games: number }> {
	return notImplemented('locationUsage');
}
