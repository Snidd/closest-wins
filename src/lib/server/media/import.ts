/**
 * Download an image by URL for import. SSRF guard: http(s) only, resolve the host and refuse
 * private/loopback/link-local/multicast/reserved addresses (IPv4 and IPv6, incl. mapped), re-check
 * on every redirect, enforce `MAX_IMAGE_BYTES`, `FETCH_TIMEOUT_MS` and `ALLOWED_IMAGE_TYPES`.
 * STUB (Wave 0).
 */
import { notImplemented } from '../not-implemented.ts';

export interface FetchedImage {
	bytes: Uint8Array;
	contentType: string;
	/** URL after redirects. */
	finalUrl: string;
}

export async function fetchRemoteImage(url: string): Promise<FetchedImage> {
	return notImplemented('fetchRemoteImage');
}

/** True for addresses an import must never reach. */
export function isForbiddenAddress(ip: string): boolean {
	return notImplemented('isForbiddenAddress');
}
