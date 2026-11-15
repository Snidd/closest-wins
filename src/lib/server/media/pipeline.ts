/**
 * Image pipeline (sharp): auto-rotate, strip all metadata (EXIF/GPS), resize to the
 * `PHOTO_SIZES` longest edges without enlarging, encode WebP. STUB (Wave 0).
 */
import type { PhotoSize } from '#lib/game/types.ts';
import { notImplemented } from '../not-implemented.ts';

export interface ProcessedImage {
	/** Dimensions of the largest variant. */
	width: number;
	height: number;
	variants: Record<PhotoSize, Uint8Array>;
}

/** Throws `ContentError('INVALID')` for non-images, oversize input or too many pixels. */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
	return notImplemented('processImage');
}
