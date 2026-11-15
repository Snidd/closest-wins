/** Redirect-target validation (pure; re-exported from `./index.ts`). */

/** A placeholder origin the candidate is resolved against; never contacted. */
const BASE = 'http://next.invalid';

/**
 * Only allow same-site relative redirects (e.g. after login). Browsers strip tab/CR/LF inside
 * URLs and treat `\` like `/`, so `/\t/evil.example` or `/\evil.example` would leave the site:
 * any control character or backslash is refused outright. The rest is decided by the URL parser
 * itself: the target must keep the placeholder origin and its normalised path must not start
 * with `//` (`/..//evil.example` normalises to that). Returns only path, query and hash.
 */
export function safeNext(next: string | null | undefined, fallback = '/host'): string {
	if (!next || !next.startsWith('/')) return fallback;
	// C0 controls, DEL, C1 controls, backslash.
	if (/[\u0000-\u001f\u007f-\u009f\\]/.test(next)) return fallback;
	let url: URL;
	try {
		url = new URL(next, BASE);
	} catch {
		return fallback;
	}
	if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;
	return url.pathname + url.search + url.hash;
}
