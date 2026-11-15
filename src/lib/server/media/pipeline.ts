/**
 * Image pipeline (sharp): auto-orient from EXIF, strip ALL metadata (EXIF/GPS/XMP/IPTC/ICC are
 * not copied to the output: sharp drops metadata unless `keepMetadata()`/`withMetadata()` is
 * called, and we never call them), resize to the `PHOTO_SIZES` longest edges without enlarging,
 * encode WebP. The photo is a clue to a location, so GPS must never survive.
 */
import sharp, { type Metadata, type SharpOptions } from 'sharp';
import { PHOTO_SIZES, type PhotoSize } from '#lib/game/types.ts';
import { ContentError } from '../content/errors.ts';
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, WEBP_QUALITY } from './limits.ts';

export interface ProcessedImage {
	/** Dimensions of the largest variant. */
	width: number;
	height: number;
	variants: Record<PhotoSize, Uint8Array>;
}

/** Input formats we decode (sharp `metadata().format`). SVG, PDF, RAW etc. are refused. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif', 'tiff']);

const SHARP_OPTIONS: SharpOptions = {
	// Decompression-bomb guard: checked against the header before decoding pixels.
	limitInputPixels: MAX_IMAGE_PIXELS,
	// 'warning' (the default) rejects many real-world JPEGs with harmless quirks.
	failOn: 'error',
	// First frame only for animated GIF/WebP.
	animated: false,
	sequentialRead: true
};

/** Throws `ContentError('INVALID')` for non-images, oversize input or too many pixels. */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
	if (input.byteLength === 0) throw new ContentError('INVALID', 'The file is empty');
	if (input.byteLength > MAX_IMAGE_BYTES) {
		throw new ContentError(
			'INVALID',
			`The image is larger than ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`
		);
	}

	let meta: Metadata;
	try {
		meta = await sharp(input, SHARP_OPTIONS).metadata();
	} catch (e) {
		if (e instanceof Error && /pixel limit/i.test(e.message)) {
			throw new ContentError('INVALID', 'The image has too many pixels');
		}
		throw new ContentError('INVALID', 'The file is not a supported image');
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
		throw new ContentError('INVALID', 'The file is not a supported image');
	}
	if (meta.format === 'heif' && meta.compression !== 'av1') {
		// HEIC (HEVC) is not in ALLOWED_IMAGE_TYPES; AVIF is.
		throw new ContentError('INVALID', 'The file is not a supported image');
	}
	if (!meta.width || !meta.height) {
		throw new ContentError('INVALID', 'The file is not a supported image');
	}
	if (meta.width * meta.height > MAX_IMAGE_PIXELS) {
		throw new ContentError('INVALID', 'The image has too many pixels');
	}

	try {
		// Decode + orient once, then resize each variant from the oriented pixels.
		const base = sharp(input, { ...SHARP_OPTIONS, autoOrient: true });
		const sizes = Object.entries(PHOTO_SIZES) as Array<[PhotoSize, number]>;
		const outputs = await Promise.all(
			sizes.map(async ([size, edge]) => {
				const { data, info } = await base
					.clone()
					.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
					.webp({ quality: WEBP_QUALITY })
					.toBuffer({ resolveWithObject: true });
				return { size, data, info };
			})
		);
		const variants = Object.fromEntries(
			outputs.map(({ size, data }) => [size, new Uint8Array(data.buffer, data.byteOffset, data.byteLength)])
		) as Record<PhotoSize, Uint8Array>;
		const largest = outputs.find((o) => o.size === 'lg')!.info;
		return { width: largest.width, height: largest.height, variants };
	} catch (e) {
		const message = e instanceof Error ? e.message : '';
		if (/pixel limit/i.test(message)) {
			throw new ContentError('INVALID', 'The image has too many pixels');
		}
		throw new ContentError('INVALID', 'The image could not be processed');
	}
}
