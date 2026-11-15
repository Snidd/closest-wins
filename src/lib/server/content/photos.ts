/**
 * Photos: the ONLY module that reads or writes the `photo` table. Uses `#lib/server/media/` for
 * downloading (SSRF guard), processing (strip metadata, WebP variants) and storing files.
 *
 * Lifecycle: a photo is created unattached (or attached right away with `locationId`). When a
 * location's photo is replaced or cleared, or the location is deleted, the old photo is deleted
 * if no other location uses it. Photos that were uploaded but never attached (an editor that was
 * abandoned before saving) are removed by `cleanupOrphanPhotos` once they are a day old; it runs
 * opportunistically after each new upload/import.
 *
 * Errors (`ContentError`): `INVALID` (not an image, too large, too many pixels, unknown photo),
 * `NOT_FOUND` (location / photo), `IMPORT_FAILED` (URL download refused or failed), `IN_USE`
 * (deleting a photo that is a location's only clue).
 */
import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import type { ImportPhotoInput, UploadPhotoInput } from '#lib/content/schemas.ts';
import { TEXT_MAX } from '#lib/content/schemas.ts';
import { PHOTO_SIZES, photoUrl, type CluePhotoView, type PhotoSize, type PhotoView } from '#lib/game/types.ts';
import { db, type Executor } from '#lib/server/db/index.ts';
import { location, photo, type Photo } from '#lib/server/db/schema.ts';
import { fetchRemoteImage } from '../media/import.ts';
import { MAX_IMAGE_BYTES } from '../media/limits.ts';
import { processImage } from '../media/pipeline.ts';
import { deletePhotoFiles, newFileKey, writePhotoFiles } from '../media/store.ts';
import { ContentError } from './errors.ts';
import { getLocation, setLocationPhoto } from './locations.ts';
import { checkLength, clean, filled, isUuid } from './validate.ts';

/** Unattached photos younger than this are kept (an editor may still be open). */
export const ORPHAN_PHOTO_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The image part of a photo (URLs per size), without credit or source: what a running round may
 * send (the credit can name the place).
 */
export function toCluePhotoView(photo: Pick<Photo, 'fileKey' | 'width' | 'height'>): CluePhotoView {
	const urls = Object.fromEntries(
		(Object.keys(PHOTO_SIZES) as PhotoSize[]).map((size) => [size, photoUrl(photo.fileKey, size)])
	) as Record<PhotoSize, string>;
	return { width: photo.width, height: photo.height, urls };
}

/** Client-facing view of a photo including its credit (revealed rounds). */
export function toPhotoView(
	photo: Pick<Photo, 'fileKey' | 'width' | 'height' | 'attribution' | 'sourceUrl'>
): PhotoView {
	return { ...toCluePhotoView(photo), attribution: photo.attribution, sourceUrl: photo.sourceUrl };
}

export async function getPhoto(id: string): Promise<Photo | null> {
	if (!isUuid(id)) return null;
	const [row] = await db.select().from(photo).where(eq(photo.id, id));
	return row ?? null;
}

/** @internal for `locations.ts` */
export async function photoExists(id: string, executor: Executor = db): Promise<boolean> {
	if (!isUuid(id)) return false;
	const [row] = await executor.select({ id: photo.id }).from(photo).where(eq(photo.id, id));
	return !!row;
}

function checkMeta(meta: { sourceUrl: string | null; attribution: string | null }) {
	const attribution = clean(meta.attribution);
	const sourceUrl = clean(meta.sourceUrl);
	checkLength('attribution', attribution, TEXT_MAX.attribution);
	checkLength('sourceUrl', sourceUrl, 2000);
	if (sourceUrl) {
		let ok = false;
		try {
			ok = ['http:', 'https:'].includes(new URL(sourceUrl).protocol);
		} catch {
			ok = false;
		}
		if (!ok) throw new ContentError('INVALID', 'The source must be an http(s) URL');
	}
	return { attribution, sourceUrl };
}

/** Processes raw image bytes (strip metadata, WebP variants), stores files and the row. */
export async function createPhotoFromBytes(
	bytes: Uint8Array,
	meta: { sourceUrl: string | null; attribution: string | null }
): Promise<Photo> {
	const cleanMeta = checkMeta(meta);
	const processed = await processImage(bytes);
	const fileKey = newFileKey();
	await writePhotoFiles(fileKey, processed.variants);
	try {
		const [row] = await db
			.insert(photo)
			.values({ fileKey, width: processed.width, height: processed.height, ...cleanMeta })
			.returning();
		void cleanupOrphanPhotos().catch((e) => console.error('[photos] orphan cleanup failed', e));
		return row!;
	} catch (e) {
		await deletePhotoFiles(fileKey).catch(() => {});
		throw e;
	}
}

async function attachNew(created: Photo, locationId: string | undefined): Promise<Photo> {
	if (!locationId) return created;
	try {
		await setLocationPhoto(locationId, created.id);
	} catch (e) {
		await deletePhotoIfUnused(created.id);
		throw e;
	}
	return created;
}

async function assertLocation(locationId: string | undefined) {
	if (locationId && !(await getLocation(locationId))) {
		throw new ContentError('NOT_FOUND', 'Location not found');
	}
}

/**
 * Downloads (SSRF-guarded) and stores a photo; attaches it if `locationId` is given. The source
 * URL defaults to the imported URL.
 */
export async function importPhotoFromUrl(input: ImportPhotoInput): Promise<Photo> {
	await assertLocation(input.locationId);
	const fetched = await fetchRemoteImage(input.url);
	const created = await createPhotoFromBytes(fetched.bytes, {
		sourceUrl: filled(input.sourceUrl) ? input.sourceUrl : input.url,
		attribution: input.attribution ?? null
	});
	return attachNew(created, input.locationId);
}

/** Stores an uploaded file; attaches it if `locationId` is given. */
export async function uploadPhoto(input: UploadPhotoInput): Promise<Photo> {
	const file = input.file;
	if (!file || typeof file.arrayBuffer !== 'function') throw new ContentError('INVALID', 'No file');
	if (file.size === 0) throw new ContentError('INVALID', 'The file is empty');
	if (file.size > MAX_IMAGE_BYTES) {
		throw new ContentError('INVALID', `The image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`);
	}
	await assertLocation(input.locationId);
	const bytes = new Uint8Array(await file.arrayBuffer());
	const created = await createPhotoFromBytes(bytes, {
		sourceUrl: input.sourceUrl ?? null,
		attribution: input.attribution ?? null
	});
	return attachNew(created, input.locationId);
}

/** Sets or clears (`null`) a location's photo. A replaced, now unused photo is deleted. */
export async function attachPhoto(locationId: string, photoId: string | null): Promise<void> {
	if (photoId !== null && !(await photoExists(photoId))) {
		throw new ContentError('NOT_FOUND', 'Photo not found');
	}
	await setLocationPhoto(locationId, photoId);
}

/** Deletes the row and its files (locations referencing it get `photo_id` null). */
export async function deletePhoto(id: string): Promise<void> {
	if (!isUuid(id)) throw new ContentError('NOT_FOUND', 'Photo not found');
	const fileKey = await db.transaction(async (tx) => {
		const [current] = await tx.select().from(photo).where(eq(photo.id, id)).for('update');
		if (!current) throw new ContentError('NOT_FOUND', 'Photo not found');
		// A location without clue text would break `location_clue_ck` when photo_id is nulled.
		const users = await tx
			.select({ id: location.id, clueTextSv: location.clueTextSv, clueTextEn: location.clueTextEn })
			.from(location)
			.where(eq(location.photoId, id))
			.for('update');
		const onlyClue = users.filter((l) => !filled(l.clueTextSv) && !filled(l.clueTextEn));
		if (onlyClue.length) {
			throw new ContentError(
				'IN_USE',
				`The photo is the only clue of ${onlyClue.length} location(s); add a clue text or another photo first`
			);
		}
		await tx.delete(photo).where(eq(photo.id, id));
		return current.fileKey;
	});
	await deletePhotoFiles(fileKey);
}

/**
 * Deletes a photo (row + files) if no location references it. Race-safe: the reference check is
 * part of the DELETE. @internal for `locations.ts`
 */
export async function deletePhotoIfUnused(id: string): Promise<boolean> {
	const deleted = await db
		.delete(photo)
		.where(
			and(
				eq(photo.id, id),
				notExists(db.select({ one: sql`1` }).from(location).where(eq(location.photoId, photo.id)))
			)
		)
		.returning({ fileKey: photo.fileKey });
	for (const { fileKey } of deleted) await deletePhotoFiles(fileKey);
	return deleted.length > 0;
}

/** Deletes photos no location uses that are older than `olderThanMs`. Returns how many. */
export async function cleanupOrphanPhotos(olderThanMs: number = ORPHAN_PHOTO_GRACE_MS): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanMs);
	const deleted = await db
		.delete(photo)
		.where(
			and(
				lt(photo.createdAt, cutoff),
				notExists(db.select({ one: sql`1` }).from(location).where(eq(location.photoId, photo.id)))
			)
		)
		.returning({ fileKey: photo.fileKey });
	for (const { fileKey } of deleted) await deletePhotoFiles(fileKey).catch(() => {});
	return deleted.length;
}
