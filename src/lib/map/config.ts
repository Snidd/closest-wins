/** Map constants shared by GuessMap, RevealMap, the admin picker and the tile script. */

/** URL of the self-hosted world basemap (served from `DATA_DIR/map/world.pmtiles`). */
export const PMTILES_URL = '/map/world.pmtiles';
/** MapLibre source URL using the pmtiles:// protocol (register the protocol first). */
export const PMTILES_SOURCE_URL = `pmtiles://${PMTILES_URL}`;

/** Highest zoom level present in the tile file. */
export const TILE_MAX_ZOOM = 8;
/** Highest zoom the user may reach (overzooming the z8 tiles). Tune in play testing. */
export const MAX_ZOOM = 10;
export const MIN_ZOOM = 0;

/** Full world view every round starts from. */
export const WORLD_VIEW = {
	center: [10, 25] as [lng: number, lat: number],
	zoom: 1.2
} as const;

/** Debounce for `updateGuess` while panning. */
export const GUESS_UPDATE_DEBOUNCE_MS = 400;
