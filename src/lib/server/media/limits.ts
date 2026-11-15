/** Limits for incoming images (uploads and URL imports). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Decompression-bomb guard for sharp (`limitInputPixels`). */
export const MAX_IMAGE_PIXELS = 60_000_000;
export const ALLOWED_IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif',
	'image/tiff'
] as const;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 3;
export const WEBP_QUALITY = 80;
