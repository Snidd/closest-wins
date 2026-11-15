import { describe, expect, it } from 'vitest';
import { haversineKm, normalizeLng, normalizeLatLng } from './geo.ts';

describe('haversineKm', () => {
	it('is zero for the same point', () => {
		expect(haversineKm({ lat: 59.3293, lng: 18.0686 }, { lat: 59.3293, lng: 18.0686 })).toBe(0);
	});

	it('matches known city distances (±0.5%)', () => {
		const cases: Array<[string, [number, number], [number, number], number]> = [
			// Reference values: great-circle distances on a 6371 km sphere.
			['London–Paris', [51.5074, -0.1278], [48.8566, 2.3522], 343.6],
			['Stockholm–Göteborg', [59.3293, 18.0686], [57.7089, 11.9746], 397.6],
			['New York–Los Angeles', [40.7128, -74.006], [34.0522, -118.2437], 3935.7],
			['Sydney–Tokyo', [-33.8688, 151.2093], [35.6762, 139.6503], 7823.4]
		];
		for (const [name, a, b, km] of cases) {
			const d = haversineKm({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
			expect(Math.abs(d - km) / km, name).toBeLessThan(0.005);
		}
	});

	it('handles the antimeridian and is symmetric', () => {
		const a = { lat: 0, lng: 179.5 };
		const b = { lat: 0, lng: -179.5 };
		expect(haversineKm(a, b)).toBeCloseTo(111.2, 0);
		expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
	});

	it('gives half the circumference for antipodes', () => {
		const d = haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
		expect(d).toBeCloseTo(Math.PI * 6371.0088, 3);
		const poles = haversineKm({ lat: 90, lng: 0 }, { lat: -90, lng: 0 });
		expect(poles).toBeCloseTo(Math.PI * 6371.0088, 3);
	});

	it('ignores longitude wrapping', () => {
		const a = { lat: 10, lng: 20 };
		expect(haversineKm(a, { lat: 10, lng: 380 })).toBeCloseTo(0, 6);
	});
});

describe('normalizeLng', () => {
	it('wraps into [-180, 180]', () => {
		expect(normalizeLng(0)).toBe(0);
		expect(normalizeLng(180)).toBe(180);
		expect(normalizeLng(-180)).toBe(-180);
		expect(normalizeLng(190)).toBeCloseTo(-170);
		expect(normalizeLng(-190)).toBeCloseTo(170);
		expect(normalizeLng(540)).toBe(180);
		expect(normalizeLng(725)).toBeCloseTo(5);
	});

	it('normalizeLatLng clamps latitude', () => {
		expect(normalizeLatLng({ lat: 95, lng: 370 })).toEqual({ lat: 90, lng: 10 });
	});
});
