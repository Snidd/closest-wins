/**
 * Browser-side helpers shared by the map components: map construction with our defaults,
 * theme detection, tile availability probe and theme switching that keeps overlay layers.
 */
import type { Map as MaplibreMap, MapOptions } from 'maplibre-gl';
import { MAX_ZOOM, MIN_ZOOM, PMTILES_URL } from './config.ts';
import { BASEMAP_SOURCE, createMapStyle, registerPmtilesProtocol, type MapTheme } from './style.ts';

export type { MaplibreMap };
export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type MapFailure = 'tiles' | 'webgl' | 'other';

/** Overlay sources/layers added by components use this id prefix (kept across theme switches). */
export const OVERLAY_PREFIX = 'cw-';

/** Theme of the page: `<html data-theme>` if forced, else the OS preference. */
export function systemTheme(): MapTheme {
	if (typeof document === 'undefined') return 'light';
	const forced = document.documentElement.dataset.theme;
	if (forced === 'light' || forced === 'dark') return forced;
	return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Calls `cb` whenever the OS preference or `<html data-theme>` changes. Returns unsubscribe. */
export function watchSystemTheme(cb: (theme: MapTheme) => void): () => void {
	const mq = matchMedia('(prefers-color-scheme: dark)');
	const fire = () => cb(systemTheme());
	mq.addEventListener('change', fire);
	const mo = new MutationObserver(fire);
	mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	return () => {
		mq.removeEventListener('change', fire);
		mo.disconnect();
	};
}

let tilesOk: Promise<boolean> | undefined;

/** HEAD request for the tile file; resolves false if it is missing. Cached once it succeeds. */
export function probeTiles(): Promise<boolean> {
	tilesOk ??= fetch(PMTILES_URL, { method: 'HEAD' })
		.then((r) => r.ok)
		.catch(() => false)
		.then((ok) => {
			if (!ok) tilesOk = undefined;
			return ok;
		});
	return tilesOk;
}

/** WebGL availability without creating a map. */
function hasWebGL(): boolean {
	try {
		const c = document.createElement('canvas');
		return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
	} catch {
		return false;
	}
}

export class MapInitError extends Error {
	readonly kind: MapFailure;
	constructor(kind: MapFailure, message: string) {
		super(message);
		this.kind = kind;
	}
}

/**
 * Creates a map with our defaults: our style, no rotation or pitch (mouse, touch, keyboard),
 * world copies on, zoom limited to [MIN_ZOOM, MAX_ZOOM], no built-in attribution control
 * (components render their own small attribution).
 */
export async function createMap(
	container: HTMLElement,
	theme: MapTheme,
	options: Omit<Partial<MapOptions>, 'container' | 'style'> = {}
): Promise<MaplibreMap> {
	const [maplibre, ok] = await Promise.all([registerPmtilesProtocol(), probeTiles()]);
	if (!ok) throw new MapInitError('tiles', `Map tiles not found at ${PMTILES_URL}`);
	if (!hasWebGL()) throw new MapInitError('webgl', 'WebGL is not available');
	let map: MaplibreMap;
	try {
		map = new maplibre.Map({
			container,
			style: createMapStyle(theme),
			attributionControl: false,
			maplibreLogo: false,
			minZoom: MIN_ZOOM,
			maxZoom: MAX_ZOOM,
			maxPitch: 0,
			dragRotate: false,
			pitchWithRotate: false,
			touchPitch: false,
			boxZoom: false,
			renderWorldCopies: true,
			fadeDuration: 0,
			...options
		});
	} catch (e) {
		throw new MapInitError('webgl', e instanceof Error ? e.message : String(e));
	}
	map.touchZoomRotate.disableRotation();
	map.keyboard.disableRotation();
	return map;
}

/** Calls `cb` once if the basemap source fails to load (e.g. file deleted or corrupt). */
export function onTileError(map: MaplibreMap, cb: (e: Error) => void): void {
	let fired = false;
	map.on('error', (ev) => {
		const msg = ev.error?.message ?? '';
		const sourceId = (ev as { sourceId?: string }).sourceId;
		const isTiles = sourceId === BASEMAP_SOURCE || /pmtiles|Bad response code|Wrong magic number/i.test(msg);
		let loaded = false;
		try {
			loaded = map.isSourceLoaded(BASEMAP_SOURCE);
		} catch {
			// Style not loaded yet: the source does not exist.
		}
		if (isTiles && !fired && !loaded) {
			fired = true;
			cb(new Error(msg || 'Map tiles failed to load'));
		}
	});
}

/** Switches the basemap colours, keeping the component's overlay sources and layers. */
export function setMapTheme(map: MaplibreMap, theme: MapTheme): void {
	map.setStyle(createMapStyle(theme), {
		diff: true,
		transformStyle: (prev, next) => {
			if (!prev) return next;
			const sources = { ...next.sources };
			for (const [id, s] of Object.entries(prev.sources)) if (id.startsWith(OVERLAY_PREFIX)) sources[id] = s;
			return {
				...next,
				sources,
				layers: [...next.layers, ...prev.layers.filter((l) => l.id.startsWith(OVERLAY_PREFIX))]
			};
		}
	});
}
