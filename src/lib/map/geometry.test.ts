import { describe, expect, it } from 'vitest';
import { haversineKm } from '#lib/geo.ts';
import {
	boundsOf,
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
	});
});

describe('worldFitZoom', () => {
	it('fits the world width and clamps', () => {
		expect(worldFitZoom(1024, 0, 3)).toBeCloseTo(1);
		expect(worldFitZoom(300, 0, 3)).toBe(0);
		expect(worldFitZoom(8192, 0, 3)).toBe(3);
	});
});
