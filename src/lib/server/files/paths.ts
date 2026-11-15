/** Runtime data directories under `DATA_DIR` (default `./data`, gitignored, a volume in prod). */
import path from 'node:path';
import { DATA_DIR } from '$app/env/private';

export function dataDir(): string {
	return path.resolve(DATA_DIR);
}

/** Photo variants: `<mediaDir>/<fileKey>/<size>.webp`, served at `/media/<fileKey>/<size>.webp`. */
export function mediaDir(): string {
	return path.join(dataDir(), 'media');
}

/** Map tiles: `<mapDir>/world.pmtiles`, served at `/map/world.pmtiles`. */
export function mapDir(): string {
	return path.join(dataDir(), 'map');
}
