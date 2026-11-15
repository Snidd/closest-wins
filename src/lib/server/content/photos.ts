/**
 * Photos: the ONLY module that reads or writes the `photo` table. Uses `#lib/server/media/` for
 * downloading, processing and storing files. `toPhotoView` is implemented (Wave 0); the rest is
 * a STUB with final signatures.
 */
import type { ImportPhotoInput, UploadPhotoInput } from '#lib/content/schemas.ts';
import { PHOTO_SIZES, photoUrl, type PhotoSize, type PhotoView } from '#lib/game/types.ts';
import type { Photo } from '#lib/server/db/schema.ts';
import { notImplemented } from '../not-implemented.ts';

/** Client-facing view of a photo (URLs per size). Used by game views and the admin UI. */
export function toPhotoView(photo: Photo): PhotoView {
	const urls = Object.fromEntries(
		(Object.keys(PHOTO_SIZES) as PhotoSize[]).map((size) => [size, photoUrl(photo.fileKey, size)])
	) as Record<PhotoSize, string>;
	return {
		width: photo.width,
		height: photo.height,
		urls,
		attribution: photo.attribution,
		sourceUrl: photo.sourceUrl
	};
}

export async function getPhoto(id: string): Promise<Photo | null> {
	return notImplemented('getPhoto');
}

/** Processes raw image bytes (strip metadata, WebP variants), stores files and the row. */
export async function createPhotoFromBytes(
	bytes: Uint8Array,
	meta: { sourceUrl: string | null; attribution: string | null }
): Promise<Photo> {
	return notImplemented('createPhotoFromBytes');
}

/** Downloads (SSRF-guarded) and stores a photo; attaches it if `locationId` is given. */
export async function importPhotoFromUrl(input: ImportPhotoInput): Promise<Photo> {
	return notImplemented('importPhotoFromUrl');
}

/** Stores an uploaded file; attaches it if `locationId` is given. */
export async function uploadPhoto(input: UploadPhotoInput): Promise<Photo> {
	return notImplemented('uploadPhoto');
}

/** Sets or clears (`null`) a location's photo. */
export async function attachPhoto(locationId: string, photoId: string | null): Promise<void> {
	return notImplemented('attachPhoto');
}

/** Deletes the row and its files (locations referencing it get `photo_id` null). */
export async function deletePhoto(id: string): Promise<void> {
	return notImplemented('deletePhoto');
}
