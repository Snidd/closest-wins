/**
 * The live-query generators: snapshots on change, presence for the lifetime of the stream, and
 * cleanup on both of Kit's cancellation paths (request abort signal while idle, `return()` while
 * suspended at a yield). Uses the dev database like engine.test.ts.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { client } from '#lib/server/db/index.ts';
import type { PlayerStateValue, TvStateValue } from '#lib/game/types.ts';
import {
	createGame,
	endGame,
	findGameByCode,
	joinGame,
	kickPlayer,
	pairTv,
	registerTv,
	resetEngineMemory,
	startRound
} from './engine.ts';
import { subscriberCount, totalSubscriberCount } from './events.ts';
import { isPresent, totalPresenceCount } from './presence.ts';
import { buildHostSnapshot } from './views.ts';
import { hostStream, playerStream, tvStream } from './streams.ts';
import { createFixture, type Fixture } from './testkit.ts';

let fx: Fixture;
let baseline: { subs: number; presence: number };

beforeEach(async () => {
	resetEngineMemory();
	fx = await createFixture(3);
	baseline = { subs: totalSubscriberCount(), presence: totalPresenceCount() };
});

afterEach(async () => {
	await fx.cleanup();
});

afterAll(async () => {
	await client.end();
});

async function newGame() {
	const r = await createGame({
		playlistId: fx.playlistId,
		roundCount: 2,
		selection: 'first',
		shuffle: false,
		timerSeconds: 30,
		language: 'sv'
	});
	fx.gameIds.push(r.gameId);
	return r;
}

async function join(code: string, nickname: string) {
	fx.clock.now += 1;
	const r = await joinGame({ code, nickname }, null);
	return { ...r, token: r.token! };
}

/** Resolves with the next value, failing instead of hanging if none arrives. */
async function nextValue<T>(it: AsyncGenerator<T>, ms = 3000): Promise<IteratorResult<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			it.next(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('stream produced nothing')), ms);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

/** Reads until `pred` matches (snapshots may repeat when presence changes). */
async function until<T>(it: AsyncGenerator<T>, pred: (v: T) => boolean): Promise<T> {
	for (let i = 0; i < 10; i++) {
		const r = await nextValue(it);
		if (r.done) throw new Error('stream ended');
		if (pred(r.value)) return r.value;
	}
	throw new Error('condition never met');
}

/**
 * Aborts like a client disconnect. A snapshot already being built may still be delivered (Kit
 * drops it), after which the stream must end.
 */
async function abortAndDrain<T>(it: AsyncGenerator<T>, ac: AbortController): Promise<void> {
	const pending = it.next();
	ac.abort();
	let r = await pending;
	for (let i = 0; i < 3 && !r.done; i++) r = await nextValue(it);
	expect(r.done).toBe(true);
}

function expectNoLeaks() {
	expect(totalSubscriberCount()).toBe(baseline.subs);
	expect(totalPresenceCount()).toBe(baseline.presence);
}

describe('playerStream', () => {
	it('streams changes, marks the player connected, and cleans up on abort while idle', async () => {
		const { gameId, joinCode } = await newGame();
		const a = await join(joinCode, 'Streamer');
		const ac = new AbortController();
		const it = playerStream(joinCode, (id) => (id === gameId ? a.token : null), ac.signal);

		const first = await until(it, (v) => v.status === 'playing');
		expect(first.status === 'playing' && first.phase).toBe('lobby');
		expect(isPresent(gameId, `player:${a.playerId}`)).toBe(true);
		// Entering presence notified the game, so the next value shows us as connected.
		await until(it, (v) => v.status === 'playing' && v.players.find((p) => p.id === a.playerId)!.connected);

		const pending = nextValue(it);
		await startRound(gameId);
		const r = await pending;
		expect(!r.done && r.value.status === 'playing' && r.value.phase).toBe('round');

		// Idle (awaiting the next change): only the abort signal can end it.
		const idle = it.next();
		ac.abort();
		expect((await idle).done).toBe(true);
		expect(isPresent(gameId, `player:${a.playerId}`)).toBe(false);
		expect(subscriberCount(gameId)).toBe(0);
		expectNoLeaks();
	});

	it('cleans up on return() while suspended at a yield', async () => {
		const { gameId, joinCode } = await newGame();
		const a = await join(joinCode, 'Returner');
		const it = playerStream(joinCode, () => a.token);
		await until(it, (v) => v.status === 'playing');
		expect(isPresent(gameId, `player:${a.playerId}`)).toBe(true);
		await it.return(undefined);
		expect(isPresent(gameId, `player:${a.playerId}`)).toBe(false);
		expectNoLeaks();
	});

	it('gates: notJoined without a token, kicked ends the stream', async () => {
		const { gameId, joinCode } = await newGame();
		const outsider = playerStream(joinCode, () => null);
		expect((await nextValue(outsider)).value).toEqual({ role: 'player', status: 'notJoined', joinable: true });
		await outsider.return(undefined);

		const a = await join(joinCode, 'Kickme');
		const it = playerStream(joinCode, () => a.token);
		await until(it, (v) => v.status === 'playing');
		const pending = until(it, (v) => v.status === 'kicked');
		await kickPlayer(gameId, a.playerId);
		expect(await pending).toEqual({ role: 'player', status: 'kicked' });
		expect((await nextValue(it)).done).toBe(true);
		expect(isPresent(gameId, `player:${a.playerId}`)).toBe(false);
		expectNoLeaks();
	});

	it('noGame for a code without an unfinished game', async () => {
		const { gameId, joinCode } = await newGame();
		await endGame(gameId);
		if (await findGameByCode(joinCode)) return; // code reused meanwhile by someone else
		const it = playerStream(joinCode, () => null);
		const v: PlayerStateValue | void = (await nextValue(it)).value;
		expect(v).toEqual({ role: 'player', status: 'noGame' });
		await it.return(undefined);
		expectNoLeaks();
	});
});

describe('hostStream', () => {
	it('registers host presence and ends on abort', async () => {
		const { gameId, joinCode } = await newGame();
		const ac = new AbortController();
		const it = hostStream(gameId, ac.signal);
		expect((await nextValue(it)).value).toMatchObject({ role: 'host', phase: 'lobby' });
		expect(isPresent(gameId, 'host:admin')).toBe(true);
		const pending = until(it, (v) => v.players.length === 1);
		await join(joinCode, 'Newcomer');
		expect((await pending).players[0]!.nickname).toBe('Newcomer');
		await abortAndDrain(it, ac);
		expectNoLeaks();
	});
});

describe('tvStream', () => {
	it('unregistered ends immediately', async () => {
		const it = tvStream(null);
		expect((await nextValue(it)).value).toEqual({ role: 'tv', status: 'unregistered' });
		expect((await nextValue(it)).done).toBe(true);
		expectNoLeaks();
	});

	it('follows its screen from pairing to a game and on to the next game without reconnecting', async () => {
		const reg = await registerTv(null);
		fx.tvIds.push(reg.tvId);
		const ac = new AbortController();
		const it = tvStream(reg.token, ac.signal);

		const gate = (await nextValue(it)).value as TvStateValue;
		if (gate.status !== 'pairing') throw new Error('expected pairing');

		const g1 = await newGame();
		const paired = until(it, (v) => v.status === 'paired');
		await pairTv(g1.gameId, gate.pairingCode);
		const s1 = await paired;
		expect(s1.status === 'paired' && [s1.game.id, s1.phase, s1.game.language]).toEqual([g1.gameId, 'lobby', 'sv']);
		expect(isPresent(g1.gameId, `tv:${reg.tvId}`)).toBe(true);
		expect((await buildHostSnapshot(g1.gameId)).tv).toEqual({ paired: true, connected: true });

		const finished = until(it, (v) => v.status === 'paired' && v.phase === 'finished' && !!v.nextPairing);
		await endGame(g1.gameId);
		const f = await finished;
		if (f.status !== 'paired' || !f.nextPairing) throw new Error('expected next pairing code');

		const g2 = await newGame();
		const moved = until(it, (v) => v.status === 'paired' && v.game.id === g2.gameId);
		await pairTv(g2.gameId, f.nextPairing.pairingCode);
		await moved;
		expect(isPresent(g1.gameId, `tv:${reg.tvId}`)).toBe(false);
		expect(isPresent(g2.gameId, `tv:${reg.tvId}`)).toBe(true);

		await abortAndDrain(it, ac);
		expect(isPresent(g2.gameId, `tv:${reg.tvId}`)).toBe(false);
		expectNoLeaks();
	});
});
