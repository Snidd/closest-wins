/**
 * Photo file storage under `DATA_DIR/media/<fileKey>/<size>.webp`. `newFileKey` is implemented
 * (Wave 0); writing/deleting is a STUB with final signatures.
 */
import { randomBytes } from 'node:crypto';
import type { PhotoSize } from '#lib/game/types.ts';
import { notImplemented } from '../not-implemented.ts';

export { mediaDir } from '../files/paths.ts';

/** Random, URL-safe and never derived from the answer (it is visible to players). */
export function newFileKey(): string {
	return randomBytes(16).toString('base64url');
}

/** Writes all variants atomically (temp dir + rename). */
export async function writePhotoFiles(fileKey: string, variants: Record<PhotoSize, Uint8Array>): Promise<void> {
	return notImplemented('writePhotoFiles');
}

export async function deletePhotoFiles(fileKey: string): Promise<void> {
	return notImplemented('deletePhotoFiles');
}
