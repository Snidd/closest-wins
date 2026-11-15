/**
 * Page chrome per route, shared by `hooks.server.ts` (server render) and the root layout
 * (client-side navigation), so `<html data-surface>` and the viewport meta are right however a
 * page was reached.
 *
 * - `tv` scales type with the viewport and hides the cursor;
 * - `play` locks page zoom, scroll and overscroll so the map owns every gesture;
 * - `host`, `admin`, `default` are ordinary pages.
 */
export type Surface = 'tv' | 'play' | 'host' | 'admin' | 'default';

export function surfaceFor(routeId: string | null | undefined): Surface {
	if (!routeId) return 'default';
	if (routeId === '/tv' || routeId.startsWith('/tv/')) return 'tv';
	if (routeId.startsWith('/play/') || routeId.startsWith('/dev/map')) return 'play';
	if (routeId === '/host' || routeId.startsWith('/host/')) return 'host';
	if (routeId === '/admin' || routeId.startsWith('/admin/')) return 'admin';
	return 'default';
}

const BASE_VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const LOCKED_VIEWPORT = `${BASE_VIEWPORT}, maximum-scale=1, user-scalable=no`;

/** Content of `<meta name="viewport">` for a surface (page zoom locked on the map and the TV). */
export function viewportFor(surface: Surface): string {
	return surface === 'play' || surface === 'tv' ? LOCKED_VIEWPORT : BASE_VIEWPORT;
}

/** Applies a surface to the live document (client-side navigation). */
export function applySurface(doc: Document, surface: Surface): void {
	const html = doc.documentElement;
	if (html.dataset.surface !== surface) html.dataset.surface = surface;
	const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
	const viewport = viewportFor(surface);
	if (meta && meta.content !== viewport) meta.content = viewport;
}
