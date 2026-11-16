/**
 * Sample TV snapshots for the native Apple TV app's decoding tests (`tvos/Fixtures/*.json`).
 *
 * Plays two small games through the real engine (dev database, fake clock, like
 * engine.test.ts) and records what `buildTvState` yields in every state, so the files are true
 * `TvStateValue` output. Volatile values (ids, join/pairing codes, photo keys, origin) are
 * replaced by fixed placeholders and the clock starts at a fixed time, so regenerating gives the
 * same files when nothing changed.
 *
 * - `TVOS_FIXTURES=1` (`pnpm tvos:fixtures`): rewrites the files.
 * - Otherwise: fails when a committed file no longer has the shape (keys and value types) of the
 *   current output, or when files are missing or left over.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { client, db } from '#lib/server/db/index.ts';
import { location, playlist } from '#lib/server/db/schema.ts';
import { expectedStateOf, type TvStateValue } from '#lib/game/types.ts';
import {
	createGame,
	endRoundNow,
	joinGame,
	lockIn,
	nextRound,
	pairTv,
	registerTv,
	resetEngineMemory,
	resolvePlayer,
	skipReveal,
	startRound,
	updateGuess
} from './engine.ts';
import { enterPresence } from './presence.ts';
import { buildHostSnapshot, buildTvState } from './views.ts';
import { addPhoto, createFixture, type Fixture } from './testkit.ts';

const REGENERATE = process.env.TVOS_FIXTURES === '1';
const FIXTURE_DIR = resolve(import.meta.dirname, '../../../../tvos/Fixtures');
const REGENERATE_HINT = 'run pnpm tvos:fixtures (needs the dev database) and commit tvos/Fixtures';

/** Fixed start of the fake clock (2026-11-16 19:00 UTC). */
const BASE_TIME = Date.UTC(2026, 10, 16, 19, 0, 0);
const FIXTURE_ORIGIN = 'http://192.168.1.20:5173';
const JOIN_CODES = ['KDRW', 'HMPT'];
const PAIRING_CODES = ['482913', '730164', '215870', '906352'];

interface Place {
	nameEn: string;
	nameSv: string;
	factEn: string;
	factSv: string;
	clueEn: string | null;
	clueSv: string | null;
	lat: number;
	lng: number;
	photo?: { attribution: string; sourceUrl: string };
}

/** Realistic content (nicer SwiftUI previews); clues never contain any place's name. */
const PLACES: Place[] = [
	{
		nameEn: 'Eiffel Tower',
		nameSv: 'Eiffeltornet',
		factEn: 'It was only meant to stand for 20 years.',
		factSv: 'Det var bara tänkt att stå i 20 år.',
		clueEn: null,
		clueSv: null,
		lat: 48.8584,
		lng: 2.2945,
		photo: {
			attribution: 'Eiffel Tower at dusk by Jane Doe, CC BY-SA 4.0',
			sourceUrl: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower_at_dusk.jpg'
		}
	},
	{
		nameEn: 'Uluru',
		nameSv: 'Uluru',
		factEn: 'The rock rises about 348 metres above the plain.',
		factSv: 'Klippan reser sig ungefär 348 meter över slätten.',
		clueEn: 'A giant red sandstone rock rises from the desert.',
		clueSv: 'En jättelik röd sandstensklippa reser sig ur öknen.',
		lat: -25.3444,
		lng: 131.0369
	},
	{
		nameEn: 'Machu Picchu',
		nameSv: 'Machu Picchu',
		factEn: 'It was built in the 15th century and rediscovered in 1911.',
		factSv: 'Den byggdes på 1400-talet och återupptäcktes 1911.',
		clueEn: 'A citadel high up in the Andes.',
		clueSv: 'En citadell högt uppe i Anderna.',
		lat: -13.1631,
		lng: -72.545,
		photo: {
			attribution: 'Machu Picchu in the morning, photo by John Smith (CC BY 2.0)',
			sourceUrl: 'https://www.flickr.com/photos/example/machu-picchu'
		}
	},
	{
		nameEn: 'Table Mountain',
		nameSv: 'Taffelberget',
		factEn: 'Its top is often covered by a "tablecloth" of cloud.',
		factSv: 'Toppen täcks ofta av en "duk" av moln.',
		clueEn: 'A flat-topped mountain above a harbour city.',
		clueSv: 'Ett platt berg ovanför en hamnstad.',
		lat: -33.9628,
		lng: 18.4098
	},
	{
		nameEn: 'Mount Fuji',
		nameSv: 'Fuji',
		factEn: 'It last erupted in 1707.',
		factSv: 'Det senaste utbrottet var 1707.',
		clueEn: 'A snow-capped volcano seen from the bullet train.',
		clueSv: 'En snöklädd vulkan som syns från snabbtåget.',
		lat: 35.3606,
		lng: 138.7274
	},
	{
		nameEn: 'Reykjavík',
		nameSv: 'Reykjavik',
		factEn: 'Most of its homes are heated by geothermal water.',
		factSv: 'De flesta hem värms med geotermiskt vatten.',
		clueEn: 'The northernmost capital of a sovereign state.',
		clueSv: 'Den nordligaste huvudstaden i en självständig stat.',
		lat: 64.1466,
		lng: -21.9426
	}
];

let fx: Fixture;
const presence: Array<() => void> = [];

beforeEach(async () => {
	resetEngineMemory();
	fx = await createFixture(PLACES.length);
	fx.clock.now = BASE_TIME;
});

afterEach(async () => {
	for (const leave of presence.splice(0)) leave();
	// The photo-only place needs its clue text back before cleanup deletes its photo
	// (`location_clue_ck`: a location needs a photo or a clue text).
	await db
		.update(location)
		.set({ clueTextEn: 'cleanup' })
		.where(
			inArray(
				location.id,
				fx.locations.map((l) => l.id)
			)
		);
	await fx.cleanup();
});

afterAll(async () => {
	await client.end();
});

// --- driving the engine --------------------------------------------------------------------------

const expected = async (gameId: string) => expectedStateOf(await buildHostSnapshot(gameId));

async function newGame(language: 'en' | 'sv', rounds: number) {
	const r = await createGame({
		playlistId: fx.playlistId,
		roundCount: rounds,
		selection: 'first',
		shuffle: false,
		timerSeconds: 30,
		language
	});
	fx.gameIds.push(r.gameId);
	return r;
}

async function join(code: string, nickname: string, connected = true) {
	fx.clock.now += 1000;
	const r = await joinGame({ code, nickname }, null);
	const p = (await resolvePlayer(r.gameId, r.token))!;
	if (connected) presence.push(enterPresence(r.gameId, `player:${p.id}`));
	return p;
}
type Joined = Awaited<ReturnType<typeof join>>;

/** A cross `deg` degrees north and east of a place. */
async function guess(p: Joined, roundIndex: number, place: Place, deg: number, lock = false) {
	const input = { gameId: p.gameId, roundIndex, lat: place.lat + deg, lng: place.lng + deg, touched: true };
	if (lock) await lockIn(p, input);
	else await updateGuess(p, input);
}

async function newTv() {
	const tv = await registerTv(null);
	fx.tvIds.push(tv.tvId);
	return tv.token!;
}

async function pairingCodeOf(token: string): Promise<string> {
	const s = await buildTvState(token);
	if (s.status !== 'pairing') throw new Error(`expected pairing, got ${s.status}`);
	return s.pairingCode;
}

/** Replaces the fixture's tagged names with `PLACES` content (and gives two places a photo). */
async function useRealisticContent(): Promise<string[]> {
	const fileKeys: string[] = [];
	for (const [i, place] of PLACES.entries()) {
		const loc = fx.locations[i]!;
		if (place.photo) fileKeys.push(await addPhoto(fx, loc, place.photo));
		await db
			.update(location)
			.set({
				nameEn: place.nameEn,
				nameSv: place.nameSv,
				factEn: place.factEn,
				factSv: place.factSv,
				clueTextEn: place.clueEn,
				clueTextSv: place.clueSv,
				lat: place.lat,
				lng: place.lng
			})
			.where(eq(location.id, loc.id));
	}
	await db
		.update(playlist)
		.set({ nameEn: 'Famous landmarks', nameSv: 'Kända landmärken' })
		.where(eq(playlist.id, fx.playlistId));
	return fileKeys;
}

/** Plays both games and returns the raw TV snapshots by fixture name. */
async function record() {
	const fileKeys = await useRealisticContent();
	const shots = new Map<string, TvStateValue>();
	const snap = async (name: string, token: string | null) => shots.set(name, await buildTvState(token));
	const gameIds: string[] = [];
	const playerIds: string[] = [];
	const [eiffel, uluru, machu] = PLACES as [Place, Place, Place];

	// Game 1 (English, 3 rounds): a full game with photo, text and photo+text clues.
	await snap('unregistered', null);
	const tv = await newTv();
	await snap('pairing', tv);
	const g = await newGame('en', 3);
	gameIds.push(g.gameId);
	const alice = await join(g.joinCode, 'Alice');
	const bob = await join(g.joinCode, 'Bob');
	const cleo = await join(g.joinCode, 'Cleo', false); // shown as disconnected
	playerIds.push(alice.id, bob.id, cleo.id);
	await pairTv(g.gameId, await pairingCodeOf(tv));
	await snap('lobby', tv);

	await startRound(g.gameId, await expected(g.gameId));
	await fx.clock.advance(4000);
	await guess(alice, 0, eiffel, 0.4, true);
	await guess(bob, 0, eiffel, 2.5);
	await fx.clock.advance(8000);
	await snap('round-photo', tv);
	await endRoundNow(g.gameId, await expected(g.gameId));
	await fx.clock.advance(1000);
	await snap('reveal', tv);
	await nextRound(g.gameId, await expected(g.gameId));
	await snap('standings', tv);

	await nextRound(g.gameId, await expected(g.gameId));
	const dara = await join(g.joinCode, 'Dara'); // late joiner: watches this round
	playerIds.push(dara.id);
	await guess(bob, 1, uluru, 1.2, true);
	await fx.clock.advance(5000);
	await snap('round-text', tv);
	await guess(alice, 1, uluru, 3);
	await endRoundNow(g.gameId, await expected(g.gameId));
	await fx.clock.advance(500);
	await skipReveal(g.gameId, await expected(g.gameId));
	await snap('reveal-skipped', tv);
	await nextRound(g.gameId, await expected(g.gameId));

	await nextRound(g.gameId, await expected(g.gameId));
	await fx.clock.advance(3000);
	await snap('round-photo-text', tv);
	await guess(alice, 2, machu, 0.2, true);
	await guess(bob, 2, machu, 5, true);
	await guess(dara, 2, machu, 1, true); // all connected players locked in: the round ends
	await fx.clock.advance(9000);
	await nextRound(g.gameId, await expected(g.gameId));
	await snap('standings-final', tv);
	await nextRound(g.gameId, await expected(g.gameId));
	await snap('finished', tv);

	// Game 2 (Swedish, 2 rounds): two leaders tie, sudden death between them.
	const tv2 = await newTv();
	const g2 = await newGame('sv', 2);
	gameIds.push(g2.gameId);
	const asa = await join(g2.joinCode, 'Åsa');
	const bjorn = await join(g2.joinCode, 'Björn');
	const cia = await join(g2.joinCode, 'Cia');
	playerIds.push(asa.id, bjorn.id, cia.id);
	await pairTv(g2.gameId, await pairingCodeOf(tv2));
	await startRound(g2.gameId, await expected(g2.gameId));
	await guess(asa, 0, eiffel, 0.1);
	await guess(bjorn, 0, eiffel, 2);
	await guess(cia, 0, eiffel, 3);
	await endRoundNow(g2.gameId, await expected(g2.gameId));
	await nextRound(g2.gameId, await expected(g2.gameId));
	await nextRound(g2.gameId, await expected(g2.gameId));
	await guess(asa, 1, uluru, 2);
	await guess(bjorn, 1, uluru, 0.1);
	await guess(cia, 1, uluru, 3);
	await endRoundNow(g2.gameId, await expected(g2.gameId));
	await nextRound(g2.gameId, await expected(g2.gameId));
	await snap('standings-sudden-death', tv2);
	await nextRound(g2.gameId, await expected(g2.gameId));
	await fx.clock.advance(6000);
	const sd = await buildTvState(tv2);
	if (sd.status !== 'paired' || sd.phase !== 'round') throw new Error('expected the sudden-death round');
	const sdPlace = PLACES.find((p) => p.clueEn === sd.round.clue.textEn);
	if (!sdPlace) throw new Error('unknown sudden-death location');
	await guess(asa, 2, sdPlace, 0.5, true);
	await snap('round-sudden-death', tv2);

	return { shots, gameIds, playerIds, fileKeys };
}

// --- normalising -----------------------------------------------------------------------------------

const uuid = (prefix: number, n: number) =>
	`${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function normalise(raw: Awaited<ReturnType<typeof record>>): Map<string, string> {
	const joinCodes = new Map<string, string>();
	const pairingCodes = new Map<string, string>();
	const fixed = (map: Map<string, string>, pool: string[], actual: string) => {
		if (!map.has(actual)) map.set(actual, pool[map.size] ?? `?${actual}`);
		return map.get(actual)!;
	};
	const replacements = new Map<string, string>();
	raw.gameIds.forEach((id, i) => replacements.set(id, uuid(10000000, i + 1)));
	raw.playerIds.forEach((id, i) => replacements.set(id, uuid(20000000, i + 1)));
	raw.fileKeys.forEach((key, i) => replacements.set(key, `fixturePhotoKey${i + 1}`.padEnd(22, '0')));

	const out = new Map<string, string>();
	for (const [name, value] of raw.shots) {
		const v = structuredClone(value);
		if (v.status === 'pairing') v.pairingCode = fixed(pairingCodes, PAIRING_CODES, v.pairingCode);
		if (v.status === 'paired') {
			v.game.joinCode = fixed(joinCodes, JOIN_CODES, v.game.joinCode);
			v.game.joinUrl = `${FIXTURE_ORIGIN}/join/${v.game.joinCode}`;
			if (v.nextPairing) v.nextPairing.pairingCode = fixed(pairingCodes, PAIRING_CODES, v.nextPairing.pairingCode);
		}
		let text = JSON.stringify(v, null, '\t');
		for (const [actual, placeholder] of replacements) text = text.replaceAll(actual, placeholder);
		const stray = (text.match(UUID_RE) ?? []).filter((id) => !/^[12]0000000-0000-4000-8000-/.test(id));
		if (stray.length) throw new Error(`${name}: unnormalised ids ${stray.join(', ')}`);
		if (text.includes(fx.tag)) throw new Error(`${name}: contains the test tag ${fx.tag}`);
		out.set(name, `${text}\n`);
	}
	return out;
}

// --- comparing -------------------------------------------------------------------------------------

type Shape = string | Shape[] | { [key: string]: Shape };

/** Keys and value types, recursively (array: the distinct shapes of its elements). */
function shapeOf(v: unknown): Shape {
	if (v === null) return 'null';
	if (Array.isArray(v)) {
		const shapes = new Map(v.map((x) => [JSON.stringify(shapeOf(x)), shapeOf(x)] as const));
		return [...shapes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, s]) => s);
	}
	if (typeof v === 'object') {
		return Object.fromEntries(
			Object.keys(v as object)
				.sort()
				.map((k) => [k, shapeOf((v as Record<string, unknown>)[k])])
		);
	}
	return typeof v;
}

// --- the test --------------------------------------------------------------------------------------

describe('tvos fixtures', () => {
	it(REGENERATE ? 'writes tvos/Fixtures' : 'tvos/Fixtures match the current TV snapshots', async () => {
		const raw = await record();
		const files = normalise(raw);

		// Running rounds carry no answer: no result, no name/fact, no photo credit, no coordinates.
		for (const [name, text] of files) {
			const value = JSON.parse(text) as TvStateValue;
			if (value.status !== 'paired' || value.phase !== 'round') continue;
			expect(value, name).not.toHaveProperty('result');
			if (value.round.clue.photo) {
				expect(Object.keys(value.round.clue.photo).sort(), name).toEqual(['height', 'urls', 'width']);
			}
			const place = PLACES.find((p) => p.clueEn === value.round.clue.textEn && p.clueSv === value.round.clue.textSv)!;
			expect(place, `${name}: clue matches a place`).toBeDefined();
			for (const p of PLACES) {
				for (const secret of [p.nameEn, p.nameSv, p.factEn, p.factSv, p.photo?.attribution, p.photo?.sourceUrl]) {
					if (secret) expect(text, `${name} leaks answer material`).not.toContain(secret);
				}
			}
			expect(text, `${name} leaks the target latitude`).not.toContain(String(place.lat));
			expect(text, `${name} leaks the target longitude`).not.toContain(String(place.lng));
		}

		if (REGENERATE) {
			mkdirSync(FIXTURE_DIR, { recursive: true });
			for (const [name, text] of files) writeFileSync(resolve(FIXTURE_DIR, `${name}.json`), text);
			return;
		}

		let committed: string[] = [];
		try {
			committed = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'));
		} catch {
			// missing directory: reported below
		}
		expect(committed.sort(), `fixture files differ: ${REGENERATE_HINT}`).toEqual(
			[...files.keys()].map((n) => `${n}.json`).sort()
		);
		for (const [name, text] of files) {
			const old = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf8')) as unknown;
			expect(shapeOf(old), `tvos/Fixtures/${name}.json has an outdated shape: ${REGENERATE_HINT}`).toEqual(
				shapeOf(JSON.parse(text))
			);
		}
	});
});
