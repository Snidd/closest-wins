/** Map constants shared by GuessMap, RevealMap, the admin picker and the tile script. */

/** URL of the self-hosted world basemap (served from `DATA_DIR/map/world.pmtiles`). */
export const PMTILES_URL = '/map/world.pmtiles';
/** MapLibre source URL using the pmtiles:// protocol (register the protocol first). */
export const PMTILES_SOURCE_URL = `pmtiles://${PMTILES_URL}`;

/**
 * Highest zoom level present in the tile file (`scripts/fetch-map.sh` MAXZOOM). z8 keeps the
 * file at ~118 MB; z9 would be ~345 MB.
 */
export const TILE_MAX_ZOOM = 8;
/** Highest zoom the user may reach (overzooming the z8 tiles). Tune in play testing. */
export const MAX_ZOOM = 10;
export const MIN_ZOOM = 0;

/**
 * Full world view. A round's guess map starts here unless the location has a start view (or the
 * player already has a cross).
 */
export const WORLD_VIEW = {
	center: [10, 25] as [lng: number, lat: number],
	zoom: 1.2
} as const;

/** Debounce for `updateGuess` while panning. */
export const GUESS_UPDATE_DEBOUNCE_MS = 400;
/** While the user keeps panning, still report at least this often. */
export const GUESS_UPDATE_MAX_WAIT_MS = 2000;

/**
 * Required attribution for the tiles: OpenStreetMap data is ODbL (attribution required);
 * Protomaps packages it; Natural Earth (rivers, low zooms) is public domain.
 */
export const ATTRIBUTION_HTML =
	'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>';
