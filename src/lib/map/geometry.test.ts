import { describe, expect, it } from 'vitest';
import { haversineKm, MERCATOR_MAX_LAT } from '#lib/geo.ts';
import {
	boundsOf,
	constrainCenterLat,
	greatCirclePath,
	lngExtent,
	padBounds,
	slicePath,
	splitAtAntimeridian,
	unwrapLng,
	unwrapPath,
	worldFitZoom,
	type LngLatTuple
} from './geometry.ts';

const pathLengthKm = (p: LngLatTuple[]) =>
	p.slice(1).reduce((s, q, i) => s + haversineKm({ lng: p[i]![0], lat: p[i]![1] }, { lng: q[0], lat: q[1] }), 0);

describe('unwrapLng / unwrapPath', () => {
	it('moves a longitude within 180° of the reference', () => {
		expect(unwrapLng(-179, 179)).toBeCloseTo(181);
		expect(unwrapLng(179, -179)).toBeCloseTo(-181);
		expect(unwrapLng(10, 0)).toBe(10);
		expect(unwrapLng(370, 0)).toBeCloseTo(10);
	});
	it('makes paths continuous', () => {
		expect(unwrapPath([[170, 0], [-175, 1], [-160, 2]])).toEqual([[170, 0], [185, 1], [200, 2]]);
	});
});

describe('greatCirclePath', () => {
	it('starts and ends at the given points', () => {
		const p = greatCirclePath({ lat: 59.33, lng: 18.07 }, { lat: 40.71, lng: -74.01 });
		expect(p[0]).toEqual([18.07, 59.33]);
		expect(p.at(-1)![0]).toBeCloseTo(-74.01);
		expect(p.at(-1)![1]).toBeCloseTo(40.71);
	});
	it('follows the great circle (length equals the haversine distance, bulges poleward)', () => {
		const a = { lat: 59.33, lng: 18.07 };
		const b = { lat: 40.71, lng: -74.01 };
		const p = greatCirclePath(a, b, 200);
		expect(pathLengthKm(p)).toBeCloseTo(haversineKm(a, b), 0);
		// Stockholm → New York passes north of both endpoints.
		expect(Math.max(...p.map((q) => q[1]))).toBeGreaterThan(60);
	});
	it('crosses the antimeridian continuously (no jump of ~360°)', () => {
		const p = greatCirclePath({ lat: -17.7, lng: 178 }, { lat: -13.8, lng: -171.8 });
		for (let i = 1; i < p.length; i++) expect(Math.abs(p[i]![0] - p[i - 1]![0])).toBeLessThan(5);
		expect(p.at(-1)![0]).toBeCloseTo(188.2);
	});
	it('handles identical points', () => {
		expect(greatCirclePath({ lat: 1, lng: 2 }, { lat: 1, lng: 2 })).toHaveLength(2);
	});
	it('uses more points for longer lines', () => {
		expect(greatCirclePath({ lat: 0, lng: 0 }, { lat: 0, lng: 3 }).length).toBeLessThan(
			greatCirclePath({ lat: 0, lng: 0 }, { lat: 0, lng: 120 }).length
		);
	});
});

describe('slicePath', () => {
	const path: LngLatTuple[] = [[0, 0], [10, 0], [20, 0]];
	it('returns the first part with an interpolated end', () => {
		expect(slicePath(path, 0.75)).toEqual([[0, 0], [10, 0], [15, 0]]);
		expect(slicePath(path, 1)).toBe(path);
	});
	it('always returns a drawable line', () => {
		expect(slicePath(path, 0)).toHaveLength(2);
	});
});

describe('splitAtAntimeridian', () => {
	it('cuts an eastward crossing with interpolated latitude', () => {
		const pieces = splitAtAntimeridian([[170, 0], [190, 10]]);
		expect(pieces).toEqual([
			[[170, 0], [180, 5]],
			[[-180, 5], [-170, 10]]
		]);
	});
	it('cuts a westward crossing given in wrapped form', () => {
		const pieces = splitAtAntimeridian([[-170, 0], [170, 10]]);
		expect(pieces).toEqual([
			[[-170, 0], [-180, 5]],
			[[180, 5], [170, 10]]
		]);
	});
	it('leaves other lines alone', () => {
		expect(splitAtAntimeridian([[0, 0], [10, 10]])).toEqual([[[0, 0], [10, 10]]]);
	});
});

describe('lngExtent / boundsOf', () => {
	it('picks the compact side across the antimeridian', () => {
		expect(lngExtent([170, -170, 175])).toEqual([170, 190]);
		expect(lngExtent([-10, 20])).toEqual([-10, 20]);
		expect(lngExtent([5])).toEqual([5, 5]);
	});
	it('computes bounds', () => {
		expect(boundsOf([[170, -10], [-175, 5]])).toEqual([[170, -10], [185, 5]]);
		expect(boundsOf([])).toBeNull();
	});
	it('pads small bounds to a minimum span and clamps latitude', () => {
		expect(padBounds([[10, 20], [10, 20]], 2)).toEqual([[9, 19], [11, 21]]);
		expect(padBounds([[0, 84], [1, 84]], 4)[1][1]).toBe(85);
		// Unchanged inside the map's latitude range.
		expect(padBounds([[0, 10], [5, 60]], 20)).toEqual([[-7.5, 10], [12.5, 60]]);
	});
	it.each([
		[89, 1.5],
		[88, 20],
		[85.04, 1.5],
		[-89.9, 1.5],
		[-86, 20],
		[90, 0.5]
	])('never inverts latitude near a pole (target %d°, min span %d°)', (lat, span) => {
		const [[, s], [, n]] = padBounds([[10, lat], [10, lat]], span);
		expect(s).toBeLessThan(n);
		expect(n - s).toBeCloseTo(span, 9);
		expect(s).toBeGreaterThanOrEqual(-85);
		expect(n).toBeLessThanOrEqual(85);
	});
	it('clamps wide bounds reaching past a pole without inverting them', () => {
		expect(padBounds([[0, -89], [30, -60]], 20)).toEqual([[0, -85], [30, -60]]);
		expect(padBounds([[0, -89], [30, 89]], 20)).toEqual([[0, -85], [30, 85]]);
	});
});

describe('worldFitZoom', () => {
	it('fits the world width and clamps', () => {
		expect(worldFitZoom(1024, 0, 3)).toBeCloseTo(1);
		expect(worldFitZoom(300, 0, 3)).toBe(0);
		expect(worldFitZoom(8192, 0, 3)).toBe(3);
	});
});

describe('constrainCenterLat', () => {
	/** Latitude at world-pixel y (0 at the top) for a world `W` px tall. */
	const latAtY = (y: number, W: number) => (2 * Math.atan(Math.exp((0.5 - y / W) * 2 * Math.PI)) * 180) / Math.PI - 90;

	it('lets the centre reach any latitude while the world is shorter than the screen', () => {
		// Zoom 0: a 512 px world on an 800 px tall screen.
		for (const lat of [85, -85, 85.05, -85.05, 0, 70]) expect(constrainCenterLat(lat, 0, 800)).toBeCloseTo(lat, 9);
		expect(constrainCenterLat(89, 0, 800)).toBeCloseTo(MERCATOR_MAX_LAT, 9);
		expect(constrainCenterLat(-89, 0, 800)).toBeCloseTo(-MERCATOR_MAX_LAT, 9);
	});
	it("matches MapLibre's default bound once the world is at least twice the screen height", () => {
		const H = 800;
		for (const zoom of [Math.log2((2 * H) / 512), 4]) {
			const W = 512 * 2 ** zoom;
			expect(constrainCenterLat(84, zoom, H)).toBeCloseTo(latAtY(H / 2, W), 9);
			expect(constrainCenterLat(-84, zoom, H)).toBeCloseTo(latAtY(W - H / 2, W), 9);
			expect(constrainCenterLat(30, zoom, H)).toBeCloseTo(30, 9);
		}
	});
	it('shrinks the slack continuously around W = H', () => {
		const H = 800;
		const zoom = Math.log2(H / 512);
		for (const lat of [89, 80, -89]) {
			expect(Math.abs(constrainCenterLat(lat, zoom - 1e-6, H) - constrainCenterLat(lat, zoom + 1e-6, H))).toBeLessThan(1e-3);
		}
		// Inside the band the bound lies between the full range and the default.
		const mid = Math.log2((1.5 * H) / 512);
		const bound = constrainCenterLat(89, mid, H);
		expect(bound).toBeLessThan(MERCATOR_MAX_LAT);
		expect(bound).toBeGreaterThan(latAtY(H / 2, 1.5 * H));
	});
	it('returns a finite latitude for a degenerate height', () => {
		for (const h of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(Number.isFinite(constrainCenterLat(89, 2, h))).toBe(true);
			expect(constrainCenterLat(40, 2, h)).toBeCloseTo(40, 9);
		}
	});
});
