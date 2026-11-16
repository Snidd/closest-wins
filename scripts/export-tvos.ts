/**
 * `pnpm tvos:export`: writes tvos/ClosestWins/Resources/shared.json (strings, player colours,
 * reveal timings, map and pairing constants for the native Apple TV app). Commit the result;
 * `scripts/tvos/shared.test.ts` fails while the committed file is out of date.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SHARED_JSON_PATH, serializeShared } from './tvos/shared.ts';

const path = resolve(import.meta.dirname, '..', SHARED_JSON_PATH);
const next = serializeShared();
let previous: string | null = null;
try {
	previous = readFileSync(path, 'utf8');
} catch {
	// first export
}
if (previous === next) {
	console.log(`${SHARED_JSON_PATH} is up to date`);
} else {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, next);
	console.log(`wrote ${SHARED_JSON_PATH}`);
}
