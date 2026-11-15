/**
 * Minimal Mapbox Vector Tile (protobuf) filter: keeps selected layers and attributes, drops
 * point features. Works on the raw protobuf without a full geometry decode (geometry bytes are
 * copied verbatim), so it is fast and dependency free.
 *
 * Spec: https://github.com/mapbox/vector-tile-spec/blob/master/2.1/vector_tile.proto
 */

/** Layer → attributes kept. Everything else is removed from the tiles. */
export const KEEP: Record<string, readonly string[]> = {
	earth: ['kind'],
	water: ['kind', 'kind_detail', 'min_zoom'],
	landcover: ['kind'],
	boundaries: ['kind', 'kind_detail', 'disputed', 'min_zoom']
};

/** Boundary kinds kept: country level only (incl. disputed / unrecognised). Sub-national
 *  (region, county, map_unit, macroregion) and maritime overlay limits are dropped. */
export const KEEP_BOUNDARY_KINDS = new Set(['country', 'unrecognized_country']);

// Plain objects, not enums: Node runs these scripts with type stripping only.
const Wire = { Varint: 0, Fixed64: 1, Bytes: 2, Fixed32: 5 } as const;
type Wire = (typeof Wire)[keyof typeof Wire];

const GeomType = { Unknown: 0, Point: 1, LineString: 2, Polygon: 3 } as const;

class Reader {
	pos = 0;
	readonly buf: Uint8Array;
	constructor(buf: Uint8Array) {
		this.buf = buf;
	}
	get done() {
		return this.pos >= this.buf.length;
	}
	varint(): number {
		let result = 0;
		let shift = 0;
		let b: number;
		do {
			b = this.buf[this.pos++]!;
			// Multiplication instead of << keeps values above 2^31 exact (ids can be large).
			result += (b & 0x7f) * 2 ** shift;
			shift += 7;
		} while (b & 0x80);
		return result;
	}
	bytes(): Uint8Array {
		const len = this.varint();
		const out = this.buf.subarray(this.pos, this.pos + len);
		this.pos += len;
		return out;
	}
	skip(wire: number) {
		if (wire === Wire.Varint) this.varint();
		else if (wire === Wire.Bytes) this.pos += this.varint();
		else if (wire === Wire.Fixed64) this.pos += 8;
		else if (wire === Wire.Fixed32) this.pos += 4;
		else throw new Error(`unsupported wire type ${wire}`);
	}
	packed(): number[] {
		const r = new Reader(this.bytes());
		const out: number[] = [];
		while (!r.done) out.push(r.varint());
		return out;
	}
}

class Writer {
	#parts: Uint8Array[] = [];
	#small: number[] = [];
	#flush() {
		if (this.#small.length) {
			this.#parts.push(Uint8Array.from(this.#small));
			this.#small = [];
		}
	}
	varint(v: number) {
		while (v >= 0x80) {
			this.#small.push((v % 0x80) | 0x80);
			v = Math.floor(v / 0x80);
		}
		this.#small.push(v);
		return this;
	}
	tag(field: number, wire: Wire) {
		return this.varint(field * 8 + wire);
	}
	bytes(field: number, data: Uint8Array) {
		this.tag(field, Wire.Bytes).varint(data.length);
		this.#flush();
		this.#parts.push(data);
		return this;
	}
	packed(field: number, values: number[]) {
		const w = new Writer();
		for (const v of values) w.varint(v);
		return this.bytes(field, w.finish());
	}
	finish(): Uint8Array {
		this.#flush();
		const out = new Uint8Array(this.#parts.reduce((n, p) => n + p.length, 0));
		let o = 0;
		for (const p of this.#parts) {
			out.set(p, o);
			o += p.length;
		}
		return out;
	}
}

const utf8 = new TextDecoder();
const utf8enc = new TextEncoder();

/** Decodes a `Value` message to a JS value (only string/bool/number are used by Protomaps). */
function decodeValue(bytes: Uint8Array): string | number | boolean | null {
	const r = new Reader(bytes);
	while (!r.done) {
		const tag = r.varint();
		const field = tag >> 3;
		const wire = tag & 7;
		if (field === 1 && wire === Wire.Bytes) return utf8.decode(r.bytes());
		if (field === 7 && wire === Wire.Varint) return r.varint() !== 0;
		if ((field === 4 || field === 5) && wire === Wire.Varint) return r.varint();
		if (field === 6 && wire === Wire.Varint) {
			const n = r.varint();
			return n % 2 ? -(n + 1) / 2 : n / 2;
		}
		if (field === 3 && wire === Wire.Fixed64) {
			const v = new DataView(bytes.buffer, bytes.byteOffset + r.pos, 8).getFloat64(0, true);
			r.pos += 8;
			return v;
		}
		if (field === 2 && wire === Wire.Fixed32) {
			const v = new DataView(bytes.buffer, bytes.byteOffset + r.pos, 4).getFloat32(0, true);
			r.pos += 4;
			return v;
		}
		r.skip(wire);
	}
	return null;
}

export interface RawFeature {
	tags: number[];
	type: number;
	geometry: Uint8Array;
}

export interface RawLayer {
	version: number;
	name: string;
	extent: number;
	keys: string[];
	values: Uint8Array[];
	features: RawFeature[];
}

function decodeLayer(bytes: Uint8Array): RawLayer {
	const r = new Reader(bytes);
	const layer: RawLayer = { version: 2, name: '', extent: 4096, keys: [], values: [], features: [] };
	while (!r.done) {
		const tag = r.varint();
		const field = tag >> 3;
		const wire = tag & 7;
		if (field === 15) layer.version = r.varint();
		else if (field === 1) layer.name = utf8.decode(r.bytes());
		else if (field === 5) layer.extent = r.varint();
		else if (field === 3) layer.keys.push(utf8.decode(r.bytes()));
		else if (field === 4) layer.values.push(r.bytes());
		else if (field === 2) {
			const fr = new Reader(r.bytes());
			const f: RawFeature = { tags: [], type: GeomType.Unknown, geometry: new Uint8Array() };
			while (!fr.done) {
				const ft = fr.varint();
				const ff = ft >> 3;
				if (ff === 2) f.tags = fr.packed();
				else if (ff === 3) f.type = fr.varint();
				else if (ff === 4) f.geometry = fr.bytes();
				else fr.skip(ft & 7);
			}
			layer.features.push(f);
		} else r.skip(wire);
	}
	return layer;
}

function layerName(bytes: Uint8Array): string {
	const r = new Reader(bytes);
	while (!r.done) {
		const tag = r.varint();
		if (tag >> 3 === 1) return utf8.decode(r.bytes());
		r.skip(tag & 7);
	}
	return '';
}

/** Feature properties as a plain object (used by tests and for inspection). */
export function featureProps(layer: RawLayer, f: RawFeature): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (let i = 0; i + 1 < f.tags.length; i += 2) {
		props[layer.keys[f.tags[i]!]!] = decodeValue(layer.values[f.tags[i + 1]!]!);
	}
	return props;
}

/** Decodes every layer of a tile (attributes only; geometry stays encoded). */
export function decodeTile(tile: Uint8Array): RawLayer[] {
	const r = new Reader(tile);
	const layers: RawLayer[] = [];
	while (!r.done) {
		const tag = r.varint();
		if (tag >> 3 === 3 && (tag & 7) === Wire.Bytes) layers.push(decodeLayer(r.bytes()));
		else r.skip(tag & 7);
	}
	return layers;
}

function encodeLayer(src: RawLayer, keep: readonly string[]): Uint8Array | null {
	const keyIndex = new Map<string, number>();
	const valueIndex = new Map<string, number>();
	const keys: string[] = [];
	const values: Uint8Array[] = [];
	const features: Uint8Array[] = [];

	for (const f of src.features) {
		if (f.type === GeomType.Point || f.type === GeomType.Unknown) continue;
		if (src.name === 'boundaries') {
			const kindIdx = f.tags.findIndex((t, i) => i % 2 === 0 && src.keys[t] === 'kind');
			const kind = kindIdx >= 0 ? decodeValue(src.values[f.tags[kindIdx + 1]!]!) : null;
			if (typeof kind !== 'string' || !KEEP_BOUNDARY_KINDS.has(kind)) continue;
		}
		const tags: number[] = [];
		for (let i = 0; i + 1 < f.tags.length; i += 2) {
			const key = src.keys[f.tags[i]!]!;
			if (!keep.includes(key)) continue;
			const valBytes = src.values[f.tags[i + 1]!]!;
			let k = keyIndex.get(key);
			if (k === undefined) {
				k = keys.push(key) - 1;
				keyIndex.set(key, k);
			}
			const vKey = Buffer.from(valBytes).toString('latin1');
			let v = valueIndex.get(vKey);
			if (v === undefined) {
				v = values.push(valBytes) - 1;
				valueIndex.set(vKey, v);
			}
			tags.push(k, v);
		}
		const w = new Writer();
		if (tags.length) w.packed(2, tags);
		w.tag(3, Wire.Varint).varint(f.type);
		w.bytes(4, f.geometry);
		features.push(w.finish());
	}
	// Keep empty layers out of the tile entirely.
	if (!features.length) return null;

	const w = new Writer();
	w.tag(15, Wire.Varint).varint(src.version);
	w.bytes(1, utf8enc.encode(src.name));
	for (const f of features) w.bytes(2, f);
	for (const k of keys) w.bytes(3, utf8enc.encode(k));
	for (const v of values) w.bytes(4, v);
	w.tag(5, Wire.Varint).varint(src.extent);
	return w.finish();
}

const zigzag = (n: number) => (n << 1) ^ (n >> 31);

/**
 * Encodes a layer of line features with one numeric attribute `r` (used for the rivers
 * overlay). Coordinates are integer tile units.
 */
export function encodeLineLayer(
	name: string,
	extent: number,
	features: Array<{ rank: number; lines: Array<Array<[number, number]>> }>
): Uint8Array {
	const ranks = [...new Set(features.map((f) => f.rank))];
	const w = new Writer();
	w.tag(15, Wire.Varint).varint(2);
	w.bytes(1, utf8enc.encode(name));
	for (const f of features) {
		const geom: number[] = [];
		let cx = 0;
		let cy = 0;
		for (const line of f.lines) {
			for (let i = 0; i < line.length; i++) {
				if (i === 0) geom.push((1 & 7) | (1 << 3));
				else if (i === 1) geom.push((2 & 7) | ((line.length - 1) << 3));
				const [x, y] = line[i]!;
				geom.push(zigzag(x - cx), zigzag(y - cy));
				cx = x;
				cy = y;
			}
		}
		const fw = new Writer();
		fw.packed(2, [0, ranks.indexOf(f.rank)]);
		fw.tag(3, Wire.Varint).varint(GeomType.LineString);
		fw.packed(4, geom);
		w.bytes(2, fw.finish());
	}
	w.bytes(3, utf8enc.encode('r'));
	for (const r of ranks) {
		// Value.uint_value (field 5); scaleranks are small non-negative integers.
		w.bytes(4, new Writer().tag(5, Wire.Varint).varint(Math.max(0, Math.round(r))).finish());
	}
	w.tag(5, Wire.Varint).varint(extent);
	return w.finish();
}

/** Returns a new (uncompressed) MVT tile with only the `KEEP` layers and attributes, plus any
 *  extra pre-encoded layers appended (drawn on top in style order, independent of tile order). */
export function filterTile(tile: Uint8Array, extraLayers: Uint8Array[] = []): Uint8Array {
	const r = new Reader(tile);
	const out = new Writer();
	while (!r.done) {
		const tag = r.varint();
		if (tag >> 3 === 3 && (tag & 7) === Wire.Bytes) {
			const bytes = r.bytes();
			const name = layerName(bytes);
			const keep = KEEP[name];
			if (!keep) continue;
			const encoded = encodeLayer(decodeLayer(bytes), keep);
			if (encoded) out.bytes(3, encoded);
		} else r.skip(tag & 7);
	}
	for (const layer of extraLayers) out.bytes(3, layer);
	return out.finish();
}
