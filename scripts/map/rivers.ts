/**
 * Major rivers from Natural Earth (public domain), baked into the basemap as an extra vector
 * layer `rivers`. Protomaps only has river lines from z9 (beyond our tile max zoom), so
 * without this the map would show only the few rivers wide enough to be polygons.
 *
 * Source: ne_10m_rivers_lake_centerlines (rivers only, no lake centre lines). Each feature
 * keeps `r` (Natural Earth scalerank, 0 = most important). A river appears in a tile from
 * zoom `min_zoom - 1` (Natural Earth's suggested min zoom), simplified per zoom
 * (Douglas-Peucker, ~0.5 px) and clipped to the tile with a small buffer.
 */
import { readFileSync } from 'node:fs';
import { encodeLineLayer } from './mvt.ts';

type Pos = [number, number];

interface InFeature {
	properties: { featurecla: string; scalerank: number; min_zoom: number };
	geometry: { type: 'LineString'; coordinates: Pos[] } | { type: 'MultiLineString'; coordinates: Pos[][] };
}

interface River {
	rank: number;
	minZoom: number;
	/** Lines in world mercator units [0, 1]. */
	lines: Pos[][];
	bbox: [number, number, number, number];
	/** Simplified lines per zoom (lazy). */
	byZoom: Map<number, Pos[][]>;
}

export const EXTENT = 4096;
const BUFFER = 64;
/** Douglas-Peucker tolerance in tile units (8 units ≈ 1 px at 512 px tiles). */
const SIMPLIFY_UNITS = 4;

function mercator([lng, lat]: Pos): Pos {
	const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
	return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

function sqSegDist(p: Pos, a: Pos, b: Pos): number {
	let [x, y] = a;
	let dx = b[0] - x;
	let dy = b[1] - y;
	if (dx !== 0 || dy !== 0) {
		const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
		if (t > 1) [x, y] = b;
		else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}
	dx = p[0] - x;
	dy = p[1] - y;
	return dx * dx + dy * dy;
}

export function simplify(points: Pos[], tol: number): Pos[] {
	if (points.length <= 2) return points;
	const sqTol = tol * tol;
	const keep = new Uint8Array(points.length);
	keep[0] = keep[points.length - 1] = 1;
	const stack: Array<[number, number]> = [[0, points.length - 1]];
	while (stack.length) {
		const [first, last] = stack.pop()!;
		let maxD = 0;
		let idx = -1;
		for (let i = first + 1; i < last; i++) {
			const d = sqSegDist(points[i]!, points[first]!, points[last]!);
			if (d > maxD) {
				maxD = d;
				idx = i;
			}
		}
		if (idx >= 0 && maxD > sqTol) {
			keep[idx] = 1;
			stack.push([first, idx], [idx, last]);
		}
	}
	return points.filter((_, i) => keep[i]);
}

/** Clips a polyline to the box (Liang-Barsky per segment), returning the inside pieces. */
export function clipLine(line: Pos[], min: number, max: number): Pos[][] {
	const out: Pos[][] = [];
	let current: Pos[] = [];
	for (let i = 0; i + 1 < line.length; i++) {
		const [x0, y0] = line[i]!;
		const [x1, y1] = line[i + 1]!;
		const dx = x1 - x0;
		const dy = y1 - y0;
		let t0 = 0;
		let t1 = 1;
		let visible = true;
		for (const [p, q] of [
			[-dx, x0 - min],
			[dx, max - x0],
			[-dy, y0 - min],
			[dy, max - y0]
		] as const) {
			if (p === 0) {
				if (q < 0) visible = false;
			} else {
				const r = q / p;
				if (p < 0) t0 = Math.max(t0, r);
				else t1 = Math.min(t1, r);
			}
		}
		if (!visible || t0 > t1) {
			if (current.length > 1) out.push(current);
			current = [];
			continue;
		}
		const a: Pos = [x0 + t0 * dx, y0 + t0 * dy];
		const b: Pos = [x0 + t1 * dx, y0 + t1 * dy];
		if (!current.length) current.push(a);
		current.push(b);
		if (t1 < 1) {
			if (current.length > 1) out.push(current);
			current = [];
		}
	}
	if (current.length > 1) out.push(current);
	return out;
}

export function loadRivers(path: string): River[] {
	const src = JSON.parse(readFileSync(path, 'utf8')) as { features: InFeature[] };
	const rivers: River[] = [];
	for (const f of src.features) {
		if (f.properties.featurecla !== 'River') continue;
		const raw = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
		const lines = raw.map((l) => l.map(mercator)).filter((l) => l.length >= 2);
		if (!lines.length) continue;
		const xs = lines.flat().map((p) => p[0]);
		const ys = lines.flat().map((p) => p[1]);
		rivers.push({
			rank: f.properties.scalerank,
			minZoom: f.properties.min_zoom,
			lines,
			bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
			byZoom: new Map()
		});
	}
	return rivers;
}

/** The encoded `rivers` layer for one tile, or null if no river crosses it. */
export function riverLayer(rivers: River[], z: number, x: number, y: number): Uint8Array | null {
	const n = 2 ** z;
	const pad = BUFFER / EXTENT / n;
	const x0 = x / n - pad;
	const y0 = y / n - pad;
	const x1 = (x + 1) / n + pad;
	const y1 = (y + 1) / n + pad;
	const features: Array<{ rank: number; lines: Array<Array<[number, number]>> }> = [];
	for (const r of rivers) {
		if (r.minZoom - 1 > z) continue;
		if (r.bbox[2] < x0 || r.bbox[0] > x1 || r.bbox[3] < y0 || r.bbox[1] > y1) continue;
		let simplified = r.byZoom.get(z);
		if (!simplified) {
			const tol = SIMPLIFY_UNITS / EXTENT / n;
			simplified = r.lines.map((l) => simplify(l, tol));
			r.byZoom.set(z, simplified);
		}
		const lines: Array<Array<[number, number]>> = [];
		for (const line of simplified) {
			const local = line.map(([px, py]) => [(px * n - x) * EXTENT, (py * n - y) * EXTENT] as Pos);
			for (const piece of clipLine(local, -BUFFER, EXTENT + BUFFER)) {
				const ints: Array<[number, number]> = [];
				for (const [px, py] of piece) {
					const p: [number, number] = [Math.round(px), Math.round(py)];
					const last = ints[ints.length - 1];
					if (!last || last[0] !== p[0] || last[1] !== p[1]) ints.push(p);
				}
				if (ints.length >= 2) lines.push(ints);
			}
		}
		if (lines.length) features.push({ rank: r.rank, lines });
	}
	if (!features.length) return null;
	return encodeLineLayer('rivers', EXTENT, features);
}
