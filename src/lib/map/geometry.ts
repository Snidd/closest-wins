/**
 * Pure geometry helpers for the map components (no MapLibre imports; unit tested).
 * Coordinates are `[lng, lat]` like GeoJSON unless named `LatLng`.
 */
import { normalizeLng, type LatLng } from '#lib/geo.ts';

export type LngLatTuple = [lng: number, lat: number];
export type Bounds = [sw: LngLatTuple, ne: LngLatTuple];

const RAD = Math.PI / 180;

/** Shifts `lng` by whole turns so it lies within 180° of `ref` (for continuous lines). */
export function unwrapLng(lng: number, ref: number): number {
	return ref + normalizeLng(lng - ref);
}

/** Makes a path continuous across the antimeridian (consecutive points < 180° apart). */
export function unwrapPath(path: LngLatTuple[]): LngLatTuple[] {
	const out: LngLatTuple[] = [];
	for (const [lng, lat] of path) {
		const prev = out[out.length - 1];
		out.push([prev ? unwrapLng(lng, prev[0]) : lng, lat]);
	}
	return out;
}

/** Central angle between two points in radians. */
export function centralAngle(a: LatLng, b: LatLng): number {
	const h =
		Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 +
		Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lng - a.lng) * RAD) / 2) ** 2;
	return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Points along the great circle from `a` to `b` (spherical linear interpolation), as a
 * continuous path: the first point has `a.lng` as given and later longitudes are unwrapped,
 * so a line crossing the antimeridian goes beyond ±180 instead of jumping across the map
 * (MapLibre draws that correctly with world copies). Antipodal points have no unique great
 * circle; a meridian-ish path is returned.
 */
export function greatCirclePath(a: LatLng, b: LatLng, segments?: number): LngLatTuple[] {
	const d = centralAngle(a, b);
	const n = segments ?? Math.max(2, Math.min(256, Math.ceil(d / RAD / 1.5)));
	if (d < 1e-9) return [
		[a.lng, a.lat],
		[unwrapLng(b.lng, a.lng), b.lat]
	];
	const [lat1, lng1, lat2, lng2] = [a.lat * RAD, a.lng * RAD, b.lat * RAD, b.lng * RAD];
	const sinD = Math.sin(d);
	const pts: LngLatTuple[] = [];
	for (let i = 0; i <= n; i++) {
		const f = i / n;
		let A: number;
		let B: number;
		if (sinD < 1e-9) {
			// Antipodal: fall back to linear blend (degenerate, any great circle is valid).
			A = 1 - f;
			B = f;
		} else {
			A = Math.sin((1 - f) * d) / sinD;
			B = Math.sin(f * d) / sinD;
		}
		const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
		const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
		const z = A * Math.sin(lat1) + B * Math.sin(lat2);
		const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD;
		const lng = Math.atan2(y, x) / RAD;
		pts.push([lng, lat]);
	}
	// Exact endpoints, then make continuous starting from a.lng.
	pts[0] = [a.lng, a.lat];
	pts[n] = [b.lng, b.lat];
	return unwrapPath(pts);
}

/**
 * The first `fraction` (0..1) of a path, interpolating the last point. Points from
 * `greatCirclePath` are evenly spaced along the arc, so this is proportional to distance.
 */
export function slicePath(path: LngLatTuple[], fraction: number): LngLatTuple[] {
	if (path.length < 2 || fraction >= 1) return path;
	const f = Math.max(0, fraction) * (path.length - 1);
	const i = Math.floor(f);
	const t = f - i;
	const out = path.slice(0, i + 1);
	const a = path[i]!;
	const b = path[i + 1];
	if (b && t > 0) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
	if (out.length === 1) out.push([...a]);
	return out;
}

/**
 * Splits a continuous (possibly unwrapped) path into pieces within [-180, 180], cutting at
 * the antimeridian with an interpolated latitude. For consumers that do not render world
 * copies (e.g. plain GeoJSON export).
 */
export function splitAtAntimeridian(path: LngLatTuple[]): LngLatTuple[][] {
	const cont = unwrapPath(path);
	const pieces: LngLatTuple[][] = [];
	let current: LngLatTuple[] = [];
	for (let i = 0; i < cont.length; i++) {
		const [lng, lat] = cont[i]!;
		if (i > 0) {
			const [plng, plat] = cont[i - 1]!;
			// World copy index of each point: crossing a boundary at (k * 360 + 180).
			const k0 = Math.floor((plng + 180) / 360);
			const k1 = Math.floor((lng + 180) / 360);
			if (k0 !== k1) {
				const edge = Math.max(k0, k1) * 360 - 180;
				const t = (edge - plng) / (lng - plng);
				const latEdge = plat + (lat - plat) * t;
				const goingEast = k1 > k0;
				current.push([goingEast ? 180 : -180, latEdge]);
				pieces.push(current);
				current = [[goingEast ? -180 : 180, latEdge]];
			}
		}
		current.push([normalizeLng(lng), lat]);
	}
	if (current.length) pieces.push(current);
	return pieces.filter((p) => p.length >= 2);
}

/**
 * Smallest longitude interval containing all `lngs` (it may cross the antimeridian; then
 * `east > 180`). Returns `[west, east]` with `west` in [-180, 180).
 */
export function lngExtent(lngs: number[]): [west: number, east: number] {
	if (!lngs.length) return [-180, 180];
	const sorted = [...new Set(lngs.map((l) => normalizeLng(l) === 180 ? -180 : normalizeLng(l)))].sort(
		(a, b) => a - b
	);
	if (sorted.length === 1) return [sorted[0]!, sorted[0]!];
	// The largest gap between neighbours (including the wrap-around gap) is left outside.
	let gapIdx = sorted.length - 1;
	let gap = sorted[0]! + 360 - sorted[sorted.length - 1]!;
	for (let i = 0; i + 1 < sorted.length; i++) {
		const g = sorted[i + 1]! - sorted[i]!;
		if (g > gap) {
			gap = g;
			gapIdx = i;
		}
	}
	if (gapIdx === sorted.length - 1) return [sorted[0]!, sorted[sorted.length - 1]!];
	const west = sorted[gapIdx + 1]!;
	const east = sorted[gapIdx]! + 360;
	return [west, east];
}

/** Bounds of points, compact across the antimeridian (east may exceed 180). */
export function boundsOf(points: LngLatTuple[]): Bounds | null {
	if (!points.length) return null;
	const [west, east] = lngExtent(points.map((p) => p[0]));
	const lats = points.map((p) => p[1]);
	return [
		[west, Math.min(...lats)],
		[east, Math.max(...lats)]
	];
}

/** Grows bounds around their centre so each side spans at least `minSpanDeg`. */
export function padBounds(bounds: Bounds, minSpanDeg: number): Bounds {
	let [[w, s], [e, n]] = bounds;
	if (e - w < minSpanDeg) {
		const c = (w + e) / 2;
		w = c - minSpanDeg / 2;
		e = c + minSpanDeg / 2;
	}
	if (n - s < minSpanDeg) {
		const c = (n + s) / 2;
		s = c - minSpanDeg / 2;
		n = c + minSpanDeg / 2;
	}
	return [
		[w, Math.max(-85, s)],
		[e, Math.min(85, n)]
	];
}

/**
 * Zoom at which the whole world width fits `widthPx` (MapLibre: 512 px world at zoom 0),
 * clamped to [minZoom, maxZoom].
 */
export function worldFitZoom(widthPx: number, minZoom: number, maxZoom: number): number {
	if (!(widthPx > 0)) return maxZoom;
	return Math.max(minZoom, Math.min(maxZoom, Math.log2(widthPx / 512)));
}
