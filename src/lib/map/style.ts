/**
 * Our own labels-free MapLibre style for the self-hosted Protomaps basemap
 * (`scripts/fetch-map.sh`), plus the browser runtime setup (worker URL + pmtiles:// protocol).
 *
 * Drawn: ocean, land, landcover tint (z0-7 in the tiles, overzoomed after), lakes and river
 * polygons, major rivers (Natural Earth lines baked into the tiles as layer `rivers`), coast
 * and lake shore lines, and country borders. No symbol layers at all, so no glyphs or
 * sprites are needed; no text, places, roads, buildings, POIs or urban areas.
 *
 * Borders: country level only. Recognised country borders are solid; borders flagged
 * `disputed` and `unrecognized_country` lines (e.g. Somaliland, Northern Cyprus, Kosovo in
 * some views) are dashed and lighter, the neutral convention. Sub-national lines (regions,
 * map units) and maritime limits are removed from the tiles by the build script.
 */
import type { MapOptions } from 'maplibre-gl';
import { ATTRIBUTION_HTML, PMTILES_SOURCE_URL, TILE_MAX_ZOOM } from './config.ts';

export type MapTheme = 'light' | 'dark';
export type StyleSpecification = Exclude<NonNullable<MapOptions['style']>, string>;
type LayerSpecification = StyleSpecification['layers'][number];
type LineWidth = NonNullable<Extract<LayerSpecification, { type: 'line' }>['paint']>['line-width'];
type MaplibreModule = typeof import('maplibre-gl');

/** Source id of the basemap in every style (used to detect tile loading errors). */
export const BASEMAP_SOURCE = 'basemap';

interface Palette {
	ocean: string;
	lake: string;
	land: string;
	coast: string;
	river: string;
	border: string;
	borderDisputed: string;
	landcover: Record<'forest' | 'grassland' | 'scrub' | 'farmland' | 'barren' | 'glacier', string>;
}

/** Colours derived from the `--color-ocean` / `--color-land` tokens in app.css. */
const PALETTES: Record<MapTheme, Palette> = {
	light: {
		ocean: '#a9cbe6',
		lake: '#b4d4ec',
		land: '#ece6d5',
		coast: '#86aecf',
		river: '#93bde0',
		border: '#8f7f8c',
		borderDisputed: '#a3949f',
		landcover: {
			forest: '#d0ddba',
			grassland: '#dfe2c3',
			scrub: '#dbddbf',
			farmland: '#e6e3c8',
			barren: '#f1e8cf',
			glacier: '#f8fbfd'
		}
	},
	dark: {
		ocean: '#12304a',
		lake: '#163a58',
		land: '#2c3a2f',
		coast: '#2f5d82',
		river: '#2f6189',
		border: '#94a39b',
		borderDisputed: '#75847c',
		landcover: {
			forest: '#28402e',
			grassland: '#33422f',
			scrub: '#33402f',
			farmland: '#334130',
			barren: '#3b3c30',
			glacier: '#5d6e79'
		}
	}
};

/** Line width that grows with zoom (exponential, continues smoothly into overzoom). */
function widthByZoom(stops: Array<[zoom: number, width: number]>): LineWidth {
	return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()] as LineWidth;
}

/** The basemap style for a colour theme. Pure; safe on the server. */
export function createMapStyle(theme: MapTheme): StyleSpecification {
	const c = PALETTES[theme];
	const layers: LayerSpecification[] = [
		{ id: 'background', type: 'background', paint: { 'background-color': c.ocean } },
		{
			id: 'earth',
			type: 'fill',
			source: BASEMAP_SOURCE,
			'source-layer': 'earth',
			paint: { 'fill-color': c.land, 'fill-antialias': false }
		},
		{
			id: 'landcover',
			type: 'fill',
			source: BASEMAP_SOURCE,
			'source-layer': 'landcover',
			maxzoom: 8,
			// urban_area is deliberately not drawn (it would point at cities).
			filter: ['in', ['get', 'kind'], ['literal', Object.keys(c.landcover)]],
			paint: {
				'fill-color': [
					'match',
					['get', 'kind'],
					...Object.entries(c.landcover).flat(),
					c.land
				] as unknown as string,
				// Protomaps has landcover only up to z7: fade it out before the z8 tiles take over
				// instead of letting it vanish abruptly.
				'fill-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 6, 0.75, 7.95, 0],
				'fill-antialias': false
			}
		},
		{
			id: 'water',
			type: 'fill',
			source: BASEMAP_SOURCE,
			'source-layer': 'water',
			// Reefs are drawn as land-coloured shallows by not drawing them; canals and docks are
			// man-made.
			filter: [
				'all',
				['!=', ['get', 'kind'], 'reef'],
				['!', ['in', ['coalesce', ['get', 'kind_detail'], ''], ['literal', ['canal', 'dock']]]]
			],
			paint: {
				'fill-color': ['match', ['get', 'kind'], 'ocean', c.ocean, c.lake],
				'fill-antialias': false
			}
		},
		{
			// Coastline: the outline of land polygons (tile seams fall in the clipped buffer).
			id: 'coast',
			type: 'line',
			source: BASEMAP_SOURCE,
			'source-layer': 'earth',
			paint: {
				'line-color': c.coast,
				'line-width': widthByZoom([
					[0, 0.35],
					[3, 0.6],
					[6, 0.9],
					[10, 1.4]
				]),
				'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 4, 0.9]
			}
		},
		{
			id: 'lake-shore',
			type: 'line',
			source: BASEMAP_SOURCE,
			'source-layer': 'water',
			minzoom: 3,
			filter: ['all', ['!=', ['get', 'kind'], 'ocean'], ['!=', ['get', 'kind'], 'reef']],
			paint: {
				'line-color': c.coast,
				'line-width': widthByZoom([
					[3, 0.3],
					[6, 0.6],
					[10, 1]
				]),
				'line-opacity': 0.8
			}
		},
		{
			id: 'rivers',
			type: 'line',
			source: BASEMAP_SOURCE,
			'source-layer': 'rivers',
			minzoom: 2,
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': c.river,
				// r = Natural Earth scalerank (0 most important … 10).
				'line-width': [
					'interpolate',
					['exponential', 1.5],
					['zoom'],
					2,
					['interpolate', ['linear'], ['get', 'r'], 0, 0.9, 6, 0.3],
					6,
					['interpolate', ['linear'], ['get', 'r'], 0, 1.8, 6, 0.8, 10, 0.5],
					10,
					['interpolate', ['linear'], ['get', 'r'], 0, 3.4, 6, 1.8, 10, 1.2]
				],
				'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 4, 1]
			}
		},
		{
			id: 'border-disputed',
			type: 'line',
			source: BASEMAP_SOURCE,
			'source-layer': 'boundaries',
			filter: [
				'any',
				['==', ['get', 'disputed'], true],
				['==', ['get', 'kind'], 'unrecognized_country']
			],
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': c.borderDisputed,
				'line-width': widthByZoom([
					[0, 0.4],
					[3, 0.7],
					[6, 1.1],
					[10, 1.6]
				]),
				'line-dasharray': [2.5, 2]
			}
		},
		{
			id: 'border',
			type: 'line',
			source: BASEMAP_SOURCE,
			'source-layer': 'boundaries',
			filter: [
				'all',
				['==', ['get', 'kind'], 'country'],
				['!=', ['coalesce', ['get', 'disputed'], false], true]
			],
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: {
				'line-color': c.border,
				'line-width': widthByZoom([
					[0, 0.45],
					[3, 0.8],
					[6, 1.3],
					[10, 2.2]
				]),
				'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.75, 4, 0.95]
			}
		}
	];

	return {
		version: 8,
		name: `closest-wins-${theme}`,
		sources: {
			[BASEMAP_SOURCE]: {
				type: 'vector',
				url: PMTILES_SOURCE_URL,
				maxzoom: TILE_MAX_ZOOM,
				attribution: ATTRIBUTION_HTML
			}
		},
		layers
	};
}

let runtime: Promise<MaplibreModule> | undefined;

/**
 * Loads MapLibre in the browser, points it at its worker bundle and registers the
 * `pmtiles://` protocol. Safe to call any number of times (one shared promise); rejects on
 * the server.
 */
export function registerPmtilesProtocol(): Promise<MaplibreModule> {
	if (typeof window === 'undefined') {
		return Promise.reject(new Error('MapLibre can only be loaded in the browser'));
	}
	runtime ??= (async () => {
		const [maplibre, worker, { Protocol }] = await Promise.all([
			import('maplibre-gl'),
			import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
			import('pmtiles')
		]);
		maplibre.setWorkerUrl(worker.default);
		const protocol = new Protocol();
		maplibre.addProtocol('pmtiles', protocol.tile);
		return maplibre;
	})();
	runtime.catch(() => (runtime = undefined));
	return runtime;
}
