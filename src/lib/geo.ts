/** Geodesy helpers shared by client and server. */

export interface LatLng {
	lat: number;
	lng: number;
}

/**
 * The map is Web Mercator: it cannot show latitudes beyond ±85.0511°, and a phone's cross
 * cannot be moved past them.
 */
export const MERCATOR_MAX_LAT = 85.0511287798066;
/**
 * Locations (answers) must lie within ±this latitude, so the map can show them and players can
 * aim at them. Enforced by the content validation (admin, MCP).
 */
export const MAX_LOCATION_LAT = 85;

/** Mean Earth radius in kilometres (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two points in kilometres (haversine formula on a sphere with
 * radius `EARTH_RADIUS_KM`). Longitudes outside [-180, 180] are fine.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
	const dLat = toRad(b.lat - a.lat);
	const dLng = toRad(b.lng - a.lng);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
	// Clamp against floating point drift slightly above 1 for antipodal points.
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Wraps a longitude into [-180, 180] (MapLibre can report values beyond after panning). */
export function normalizeLng(lng: number): number {
	if (lng >= -180 && lng <= 180) return lng;
	const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
	return wrapped === -180 && lng > 0 ? 180 : wrapped;
}

/** Clamps a latitude into [-90, 90]. */
export function clampLat(lat: number): number {
	return Math.max(-90, Math.min(90, lat));
}

/** Normalises a point so it satisfies the database CHECK constraints. */
export function normalizeLatLng(p: LatLng): LatLng {
	return { lat: clampLat(p.lat), lng: normalizeLng(p.lng) };
}
