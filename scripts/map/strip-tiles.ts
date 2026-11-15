/**
 * Slims a Protomaps basemap extract down to what our labels-free style draws.
 *
 *   node scripts/map/strip-tiles.ts <input.pmtiles> <output.mbtiles> [rivers.geojson]
 *
 * Keeps only the `earth`, `water`, `landcover` and `boundaries` layers, drops point features
 * (labels; we draw no symbols), drops `name*` and other unused attributes, and drops
 * sub-national boundaries. If a Natural Earth rivers GeoJSON is given, adds a `rivers` line
 * layer (see rivers.ts). The result is written as MBTiles (gzip MVT) which
 * `pmtiles convert` turns back into a clustered, deduplicated PMTiles archive.
 * Called by scripts/fetch-map.sh; no dependencies beyond Node 22+ (node:sqlite) and `pmtiles`.
 */
import { closeSync, existsSync, openSync, readSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { filterTile, KEEP } from './mvt.ts';
import { loadRivers, riverLayer } from './rivers.ts';

class NodeFileSource implements Source {
	#fd: number;
	#path: string;
	constructor(path: string) {
		this.#path = path;
		this.#fd = openSync(path, 'r');
	}
	getKey() {
		return this.#path;
	}
	async getBytes(offset: number, length: number): Promise<RangeResponse> {
		const buf = Buffer.alloc(length);
		const n = readSync(this.#fd, buf, 0, length, offset);
		return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) };
	}
	close() {
		closeSync(this.#fd);
	}
}

const [input, output, riversPath] = process.argv.slice(2);
if (!input || !output) {
	console.error('usage: node scripts/map/strip-tiles.ts <input.pmtiles> <output.mbtiles> [rivers.geojson]');
	process.exit(2);
}
const rivers = riversPath ? loadRivers(riversPath) : [];

const source = new NodeFileSource(input);
const archive = new PMTiles(source);
const header = await archive.getHeader();
const metadata = (await archive.getMetadata()) as {
	vector_layers?: Array<{ id: string; fields?: Record<string, string>; minzoom?: number; maxzoom?: number }>;
	[k: string]: unknown;
};

if (existsSync(output)) rmSync(output);
const db = new DatabaseSync(output);
db.exec(`
	PRAGMA journal_mode = OFF;
	PRAGMA synchronous = OFF;
	CREATE TABLE metadata (name TEXT, value TEXT);
	CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
	CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
`);

const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');
let inBytes = 0;
let outBytes = 0;
let count = 0;
// Identical source tiles (open ocean, ice) are common; reuse their result.
const memo = new Map<string, Uint8Array>();

db.exec('BEGIN');
for (let z = header.minZoom; z <= header.maxZoom; z++) {
	const n = 1 << z;
	for (let x = 0; x < n; x++) {
		for (let y = 0; y < n; y++) {
			const tile = await archive.getZxy(z, x, y);
			if (!tile) continue;
			const raw = new Uint8Array(tile.data);
			inBytes += raw.byteLength;
			const extra = rivers.length ? riverLayer(rivers, z, x, y) : null;
			const key = !extra && raw.byteLength < 4096 ? Buffer.from(raw).toString('base64') : '';
			let out = key ? memo.get(key) : undefined;
			if (!out) {
				out = gzipSync(filterTile(raw, extra ? [extra] : []), { level: 9 });
				if (key) memo.set(key, out);
			}
			outBytes += out.byteLength;
			insert.run(z, x, n - 1 - y, out);
			count++;
		}
	}
	process.stderr.write(`  z${z} done (${count} tiles)\n`);
}
db.exec('COMMIT');

const layers = (metadata.vector_layers ?? [])
	.filter((l) => l.id in KEEP)
	.map((l) => ({
		...l,
		fields: Object.fromEntries(
			Object.entries(l.fields ?? {}).filter(([k]) => KEEP[l.id]!.includes(k))
		)
	}));
if (rivers.length) {
	layers.push({ id: 'rivers', fields: { r: 'Number' }, minzoom: header.minZoom, maxzoom: header.maxZoom });
}

const meta: Record<string, string> = {
	name: 'Closest Wins world basemap',
	format: 'pbf',
	type: 'baselayer',
	minzoom: String(header.minZoom),
	maxzoom: String(header.maxZoom),
	bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat].join(','),
	center: `${header.centerLon},${header.centerLat},${header.centerZoom}`,
	attribution:
		'<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>, <a href="https://protomaps.com">Protomaps</a>, Natural Earth',
	description: `Protomaps basemap ${String(metadata.version ?? '')} (layers: ${Object.keys(KEEP).join(', ')}) stripped for Closest Wins${rivers.length ? ', plus Natural Earth 10m rivers' : ''}`,
	version: String(metadata.version ?? ''),
	json: JSON.stringify({ vector_layers: layers }),
	'planetiler:osm:osmosisreplicationtime': String(metadata['planetiler:osm:osmosisreplicationtime'] ?? '')
};
const insertMeta = db.prepare('INSERT INTO metadata VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) insertMeta.run(k, v);
db.close();
source.close();

const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
console.error(`stripped ${count} tiles: ${mb(inBytes)} raw MVT → ${mb(outBytes)} gzip`);
