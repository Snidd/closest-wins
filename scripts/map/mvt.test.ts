import { describe, expect, it } from 'vitest';
import { decodeTile, encodeLineLayer, featureProps, filterTile } from './mvt.ts';
import { clipLine, simplify } from './rivers.ts';

/** Wraps encoded layers into a tile (field 3, length-delimited). */
function tileOf(...layers: Uint8Array[]): Uint8Array {
	const parts: number[] = [];
	for (const l of layers) {
		parts.push(0x1a);
		let n = l.length;
		while (n >= 0x80) {
			parts.push((n & 0x7f) | 0x80);
			n >>>= 7;
		}
		parts.push(n, ...l);
	}
	return Uint8Array.from(parts);
}

const line = (r: number) => ({ rank: r, lines: [[[0, 0], [10, 10], [20, 5]] as Array<[number, number]>] });

describe('mvt', () => {
	it('round-trips an encoded line layer', () => {
		const [layer] = decodeTile(tileOf(encodeLineLayer('rivers', 4096, [line(3), line(7)])));
		expect(layer!.name).toBe('rivers');
		expect(layer!.features).toHaveLength(2);
		expect(layer!.features.map((f) => featureProps(layer!, f))).toEqual([{ r: 3 }, { r: 7 }]);
		expect(layer!.features[0]!.type).toBe(2);
	});

	it('drops unknown layers, keeps known ones and appends extra layers', () => {
		const tile = tileOf(encodeLineLayer('roads', 4096, [line(1)]), encodeLineLayer('water', 4096, [line(1)]));
		const out = decodeTile(filterTile(tile, [encodeLineLayer('rivers', 4096, [line(2)])]));
		expect(out.map((l) => l.name)).toEqual(['water', 'rivers']);
		// `r` is not in the water allow-list, so the attribute is stripped.
		expect(featureProps(out[0]!, out[0]!.features[0]!)).toEqual({});
	});

	it('drops non-country boundaries', () => {
		const tile = tileOf(encodeLineLayer('boundaries', 4096, [line(1)]));
		// Features have no `kind`, so they are not country borders: the layer disappears.
		expect(decodeTile(filterTile(tile))).toEqual([]);
	});
});

describe('rivers geometry', () => {
	it('clips a line to the box', () => {
		expect(clipLine([[-10, 5], [20, 5]], 0, 10)).toEqual([[[0, 5], [10, 5]]]);
		expect(clipLine([[-10, -10], [-5, -5]], 0, 10)).toEqual([]);
		// Leaves and re-enters: two pieces.
		expect(clipLine([[2, 2], [20, 2], [20, 8], [2, 8]], 0, 10)).toHaveLength(2);
	});
	it('simplifies collinear points away', () => {
		expect(simplify([[0, 0], [1, 0.0001], [2, 0]], 0.01)).toEqual([[0, 0], [2, 0]]);
	});
});
