/**
 * Engine against the real dev database (port 5433). Each test creates its own uniquely named
 * locations, playlist, games and TVs and deletes exactly those afterwards. Clock and timers are
 * fake (testkit.ts), so rounds "last" 30 s without anyone waiting.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { client, db } from '#lib/server/db/index.ts';
import { game, gameRound, guess, location, player } from '#lib/server/db/schema.ts';
import { REVEAL_HOLD_MS, REVEAL_PIN_STEP_MS } from '#lib/game/reveal.ts';
import {
	expectedStateOf,
	MAX_PLAYERS,
	PAIRING_CODE_TTL_MS,
	type ExpectedState,
	type HostSnapshot
} from '#lib/game/types.ts';
import {
	armedRoundTimers,
	createGame,
	endGame,
	endRoundNow as engineEndRoundNow,
	GameError,
	initEngine,
	isGameFull,
	joinGame,
	kickPlayer,
	lockIn,
	nextRound as engineNextRound,
	onEngineEvent,
	pairTv,
	registerTv,
	resetEngineMemory,
	resolvePlayer,
	resolveTv,
	skipReveal as engineSkipReveal,
	startEngine,
	startRound as engineStartRound,
	updateGuess,
	DISCONNECT_GRACE_MS,
	RETRY_BASE_MS,
	ROUND_END_GRACE_MS,
	type EngineEvent
} from './engine.ts';
import { buildHostSnapshot, buildPlayerStateForGame, buildTvState, buildTvStateFor } from './views.ts';
import { getGameHistory, listGames } from './history.ts';
import { enterPresence } from './presence.ts';
import { subscribeGame } from './events.ts';
import { haversineKm } from './rules.ts';
import { addPhoto, createFixture, type Fixture, type FixtureLocation } from './testkit.ts';

let fx: Fixture;
let events: EngineEvent[] = [];
let stopEvents = () => {};
const presence: Array<() => void> = [];

beforeEach(async () => {
	resetEngineMemory();
	fx = await createFixture(6);
	events = [];
	stopEvents = onEngineEvent((e) => events.push(e));
});

afterEach(async () => {
	vi.restoreAllMocks();
	stopEvents();
	for (const leave of presence.splice(0)) leave();
	await fx.cleanup();
});

afterAll(async () => {
	await client.end();
});

// --- helpers -------------------------------------------------------------------------------------

const TIMER_S = 30;

async function newGame(rounds = 3, opts: { timerSeconds?: number } = {}) {
	const r = await createGame({
		playlistId: fx.playlistId,
		roundCount: rounds,
		selection: 'first',
		shuffle: false,
		timerSeconds: opts.timerSeconds ?? TIMER_S,
		language: 'en'
	});
	fx.gameIds.push(r.gameId);
	return r;
}

async function join(code: string, nickname: string, opts: { connected?: boolean } = {}) {
	fx.clock.now += 1; // distinct join times keep the join order deterministic
	const r = await joinGame({ code, nickname }, null);
	const p = (await resolvePlayer(r.gameId, r.token))!;
	if (opts.connected !== false) presence.push(enterPresence(r.gameId, `player:${p.id}`));
	return { ...r, token: r.token!, player: p };
}
type Joined = Awaited<ReturnType<typeof join>>;

/** A point `deg` degrees north of the location (distance grows with `deg`). */
const near = (loc: FixtureLocation, deg: number) => ({ lat: loc.lat + deg, lng: loc.lng });

async function place(
	j: Joined,
	roundIndex: number,
	pos: { lat: number; lng: number },
	opts: { touched?: boolean; lock?: boolean } = {}
) {
	const input = { gameId: j.gameId, roundIndex, ...pos, touched: opts.touched ?? true };
	if (opts.lock) await lockIn(j.player, input);
	else await updateGuess(j.player, input);
}

/** The state a host looking at the game right now would send with a command. */
async function current(gameId: string): Promise<ExpectedState> {
	return expectedStateOf(await buildHostSnapshot(gameId));
}
// Host commands as sent from the current state (most tests); races pass a stale one explicitly.
const startRound = async (gameId: string) => engineStartRound(gameId, await current(gameId));
const endRoundNow = async (gameId: string) => engineEndRoundNow(gameId, await current(gameId));
const skipReveal = async (gameId: string) => engineSkipReveal(gameId, await current(gameId));
const nextRound = async (gameId: string) => engineNextRound(gameId, await current(gameId));

async function phaseOf(gameId: string) {
	const [g] = await db.select().from(game).where(eq(game.id, gameId));
	return g!.phase;
}

const roundEnds = () => events.filter((e) => e.type === 'roundEnded');

async function expectGameError(p: Promise<unknown>, code: string) {
	await expect(p).rejects.toSatisfy((e) => e instanceof GameError && e.code === code);
}

// --- tests ---------------------------------------------------------------------------------------

describe('a full game', () => {
	it('plays three rounds (timer, host, all locked) to a clear winner', async () => {
		const { gameId, joinCode } = await newGame(3);
		const a = await join(joinCode, 'Alice');
		const b = await join(joinCode, 'Bob');
		const [l0, l1, l2] = fx.locations;

		let host = await buildHostSnapshot(gameId);
		expect(host.phase).toBe('lobby');
		expect(host.game.totalRounds).toBe(3);
		expect(host.players.map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
		expect(host.players.every((p) => p.connected)).toBe(true);
		expect(host.players[0]!.color).not.toBe(host.players[1]!.color);

		// Round 1 ends on the timer.
		await startRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'round') throw new Error('expected round');
		expect(host.round.number).toBe(1);
		expect(host.round.endsAt - host.round.startedAt).toBe(TIMER_S * 1000);
		expect(host.round.clue.textEn).toBe(l0!.clue);
		expect(armedRoundTimers().get(gameId)).toBeDefined();
		await place(a, 0, near(l0!, 0.5));
		await place(b, 0, near(l0!, 3));
		await fx.clock.advance(TIMER_S * 1000 - 1);
		expect(await phaseOf(gameId)).toBe('round');
		await fx.clock.advance(1 + ROUND_END_GRACE_MS);
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds().map((e) => e.type === 'roundEnded' && e.reason)).toEqual(['timer']);

		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.target).toMatchObject({ lat: l0!.lat, lng: l0!.lng, nameEn: l0!.name, factEn: l0!.fact });
		expect(host.result.winnerPlayerIds).toEqual([a.playerId]);
		expect(host.result.guesses.map((g) => [g.playerId, g.rank, g.isWinner, g.locked])).toEqual([
			[a.playerId, 1, true, false],
			[b.playerId, 2, false, false]
		]);
		expect(host.result.guesses[0]!.distanceKm).toBeCloseTo(haversineKm(near(l0!, 0.5), l0!), 6);
		// Two guesses: one pin per step, then the hold.
		expect(host.result.answerVisibleAt).toBe(host.result.revealStartedAt + 2 * REVEAL_PIN_STEP_MS + REVEAL_HOLD_MS);
		const { revealStartedAt } = host.result;
		expect(host.result.guesses.map((g) => g.revealAt - revealStartedAt).sort((x, y) => x - y)).toEqual([
			REVEAL_PIN_STEP_MS,
			2 * REVEAL_PIN_STEP_MS
		]);
		expect(host.standings.map((s) => [s.playerId, s.roundsWon])).toEqual([
			[a.playerId, 1],
			[b.playerId, 0]
		]);
		const [stored] = await db
			.select()
			.from(guess)
			.where(and(eq(guess.playerId, a.playerId)));
		expect(stored!.distanceKm).toBeCloseTo(host.result.guesses[0]!.distanceKm, 9);

		// Player view of the reveal.
		const pa = await buildPlayerStateForGame(gameId, a.token);
		if (pa.status !== 'playing' || pa.phase !== 'reveal') throw new Error('expected reveal');
		expect(pa.myResult).toEqual({ distanceKm: host.result.guesses[0]!.distanceKm, rank: 1, won: true });

		await skipReveal(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.skipped).toBe(true);
		expect(host.result.answerVisibleAt).toBe(fx.clock.now);

		await nextRound(gameId); // → standings
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({ kind: 'round', number: 2 });

		// Round 2 ends by the host.
		await nextRound(gameId);
		await place(a, 1, near(l1!, 0.2));
		await place(b, 1, near(l1!, 0.9), { lock: true });
		await endRoundNow(gameId);
		expect(await phaseOf(gameId)).toBe('reveal');
		await nextRound(gameId);
		await nextRound(gameId);

		// Round 3 ends when everyone connected has locked in; Bob wins it.
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'round') throw new Error('expected round');
		expect(host.round.number).toBe(3);
		await place(a, 2, near(l2!, 4), { lock: true });
		expect(await phaseOf(gameId)).toBe('round');
		await place(b, 2, near(l2!, 1), { lock: true });
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds().map((e) => e.type === 'roundEnded' && e.reason)).toEqual(['timer', 'host', 'allLocked']);
		expect(armedRoundTimers().has(gameId)).toBe(false);

		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({ kind: 'finish', winnerPlayerIds: [a.playerId] });
		expect(host.roundsPlayed).toBe(3);

		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'finished') throw new Error('expected finished');
		expect(host.winnerPlayerIds).toEqual([a.playerId]);
		expect(host.endedEarly).toBe(false);
		expect(host.standings.map((s) => [s.nickname, s.roundsWon, s.rank])).toEqual([
			['Alice', 2, 1],
			['Bob', 1, 2]
		]);

		// Finished: further commands are wrong-phase; the player still sees the final standings.
		await expectGameError(nextRound(gameId), 'WRONG_PHASE');
		const pf = await buildPlayerStateForGame(gameId, a.token);
		expect(pf.status === 'playing' && pf.phase).toBe('finished');

		// History.
		const detail = await getGameHistory(gameId);
		expect(detail.rounds.map((r) => r.winnerPlayerIds)).toEqual([[a.playerId], [a.playerId], [b.playerId]]);
		expect(detail.winners.map((w) => w.nickname)).toEqual(['Alice']);
		expect(detail.roundsPlayed).toBe(3);
		expect(detail.playerCount).toBe(2);
		const list = await listGames({ limit: 200, offset: 0 });
		expect(list.find((g) => g.id === gameId)?.winners.map((w) => w.nickname)).toEqual(['Alice']);
	});
});

describe('end of game ties', () => {
	async function tiedGame() {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Ann');
		const b = await join(joinCode, 'Ben');
		const c = await join(joinCode, 'Cid');
		const [l0, l1] = fx.locations;
		await startRound(gameId);
		await place(a, 0, near(l0!, 0.1));
		await place(b, 0, near(l0!, 2));
		await place(c, 0, near(l0!, 3));
		await endRoundNow(gameId);
		await nextRound(gameId);
		await nextRound(gameId);
		await place(a, 1, near(l1!, 2));
		await place(b, 1, near(l1!, 0.1));
		await place(c, 1, near(l1!, 3));
		await endRoundNow(gameId);
		await nextRound(gameId); // standings after the last regular round: Ann 1, Ben 1, Cid 0
		return { gameId, a, b, c };
	}

	it('sudden death between the tied leaders only, on an unused location', async () => {
		const { gameId, a, b, c } = await tiedGame();
		let host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({ kind: 'suddenDeath', eligiblePlayerIds: [a.playerId, b.playerId] });

		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'round') throw new Error('expected round');
		expect(host.round.isSuddenDeath).toBe(true);
		expect(host.round.number).toBe(1);
		expect(host.round.index).toBe(2);
		expect(host.round.eligiblePlayerIds).toEqual([a.playerId, b.playerId]);
		const [sd] = await db
			.select()
			.from(gameRound)
			.where(and(eq(gameRound.gameId, gameId), eq(gameRound.index, 2)));
		const used = [fx.locations[0]!.id, fx.locations[1]!.id];
		expect(used).not.toContain(sd!.locationId);
		const loc = fx.locations.find((l) => l.id === sd!.locationId)!;

		// Cid spectates.
		const pc = await buildPlayerStateForGame(gameId, c.token);
		if (pc.status !== 'playing' || pc.phase !== 'round') throw new Error('expected round');
		expect(pc.canGuess).toBe(false);
		expect(pc.myGuess).toBeNull();
		await expectGameError(place(c, 2, near(loc, 0)), 'NOT_ELIGIBLE');

		// Early finish only waits for the eligible players.
		await place(a, 2, near(loc, 0.3), { lock: true });
		await place(b, 2, near(loc, 0.6), { lock: true });
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.winnerPlayerIds).toEqual([a.playerId]);
		expect(host.result.noGuessPlayerIds).toEqual([]);
		const pcReveal = await buildPlayerStateForGame(gameId, c.token);
		expect(pcReveal.status === 'playing' && pcReveal.phase === 'reveal' && pcReveal.myResult).toBeNull();

		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({ kind: 'finish', winnerPlayerIds: [a.playerId] });
		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		expect(host.phase === 'finished' && host.winnerPlayerIds).toEqual([a.playerId]);
	});

	it('a sudden-death tie (nobody guessed) leads to another sudden-death round', async () => {
		const { gameId } = await tiedGame();
		await nextRound(gameId);
		await endRoundNow(gameId); // nobody guessed
		await nextRound(gameId);
		const host = await buildHostSnapshot(gameId);
		expect(host.phase === 'standings' && host.next.kind).toBe('suddenDeath');
		await nextRound(gameId);
		const again = await buildHostSnapshot(gameId);
		expect(again.phase === 'round' && [again.round.isSuddenDeath, again.round.number]).toEqual([true, 2]);
	});

	it('shares the win when no unused location is left', async () => {
		fx.library = fx.locations.slice(0, 2).map((l) => l.id); // exactly the two played ones
		const { gameId, a, b } = await tiedGame();
		let host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({ kind: 'finish', winnerPlayerIds: [a.playerId, b.playerId] });
		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'finished') throw new Error('expected finished');
		expect(host.winnerPlayerIds).toEqual([a.playerId, b.playerId]);
		expect(host.endedEarly).toBe(false);
	});
});

describe('guess rules', () => {
	it('on timer expiry: touched unlocked counts, untouched does not, locked counts', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Touched');
		const b = await join(joinCode, 'Untouched');
		const c = await join(joinCode, 'Locked');
		const d = await join(joinCode, 'Absent');
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 2));
		await place(b, 0, near(l0, 0), { touched: false }); // right on target, but never touched
		await place(c, 0, near(l0, 5), { touched: false, lock: true });
		// A later update with touched=false does not un-touch.
		await place(a, 0, near(l0, 1), { touched: false });
		await fx.clock.advance(TIMER_S * 1000 + ROUND_END_GRACE_MS);

		const host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.winnerPlayerIds).toEqual([a.playerId]);
		expect(host.result.guesses.map((g) => [g.playerId, g.locked])).toEqual([
			[a.playerId, false],
			[c.playerId, true]
		]);
		expect(host.result.guesses[0]!.distanceKm).toBeCloseTo(haversineKm(near(l0, 1), l0), 6);
		expect(host.result.noGuessPlayerIds.sort()).toEqual([b.playerId, d.playerId].sort());
		const [bGuess] = await db.select().from(guess).where(eq(guess.playerId, b.playerId));
		expect(bGuess!.distanceKm).toBeNull();
		const pb = await buildPlayerStateForGame(gameId, b.token);
		expect(pb.status === 'playing' && pb.phase === 'reveal' && pb.myResult).toEqual({
			distanceKm: null,
			rank: null,
			won: false
		});
	});

	it('locks are final; stale and post-lock updates are handled', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Locker');
		await join(joinCode, 'Other');
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 1), { lock: true });
		await place(a, 0, near(l0, 0)); // ignored silently
		await expectGameError(place(a, 0, near(l0, 0), { lock: true }), 'ALREADY_LOCKED');
		const [g] = await db.select().from(guess).where(eq(guess.playerId, a.playerId));
		expect(g!.lat).toBeCloseTo(l0.lat + 1, 9);
		await expectGameError(place(a, 1, near(l0, 0), { lock: true }), 'STALE_ROUND');
		await place(a, 1, near(l0, 0)); // stale update: ignored, no row
		const pa = await buildPlayerStateForGame(gameId, a.token);
		if (pa.status !== 'playing' || pa.phase !== 'round') throw new Error('expected round');
		expect(pa.canGuess).toBe(true);
		expect(pa.myGuess).toMatchObject({ lat: l0.lat + 1, lng: l0.lng, touched: true });
		expect(pa.myGuess!.lockedAt).toBe(fx.clock.now);
		expect(pa.lockedPlayerIds).toEqual([a.playerId]);
	});

	it('normalises wrapped longitudes from the map', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Wrap');
		await startRound(gameId);
		await place(a, 0, { lat: 10, lng: 370 });
		const [g] = await db.select().from(guess).where(eq(guess.playerId, a.playerId));
		expect(g!.lng).toBeCloseTo(10, 9);
	});
});

describe('early finish and presence', () => {
	it('a disconnected unlocked player does not block; the last unlocked one leaving ends the round', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Stay');
		const b = await join(joinCode, 'Leaver');
		await join(joinCode, 'Offline', { connected: false });
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 1), { lock: true });
		expect(await phaseOf(gameId)).toBe('round'); // still waiting for Leaver

		// A quick refresh (reconnect within the grace period) does not end the round.
		const leaveB = presence[1]!;
		leaveB();
		const back = enterPresence(gameId, `player:${b.playerId}`);
		await fx.clock.advance(DISCONNECT_GRACE_MS);
		expect(await phaseOf(gameId)).toBe('round');

		back();
		await fx.clock.advance(DISCONNECT_GRACE_MS - 1);
		expect(await phaseOf(gameId)).toBe('round');
		await fx.clock.advance(1);
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds()).toEqual([expect.objectContaining({ reason: 'allLocked' })]);
	});

	it('a player within the disconnect grace still counts when others lock in or are kicked', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Quick');
		const b = await join(joinCode, 'Blip');
		const c = await join(joinCode, 'Kickme');
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(c, 0, near(l0, 3), { lock: true });

		// Bob's stream drops for a moment; Alice locks in and Cid is kicked meanwhile.
		presence[1]!();
		fx.clock.now += 1000;
		await place(a, 0, near(l0, 1), { lock: true });
		expect(await phaseOf(gameId)).toBe('round');
		await kickPlayer(gameId, c.playerId);
		expect(await phaseOf(gameId)).toBe('round');
		// He is back within the grace period and keeps his remaining time.
		presence.push(enterPresence(gameId, `player:${b.playerId}`));
		await fx.clock.advance(DISCONNECT_GRACE_MS * 2);
		expect(await phaseOf(gameId)).toBe('round');

		// Gone for good this time: the round ends exactly when his grace runs out.
		presence.pop()!();
		const goneAt = fx.clock.now;
		await fx.clock.advance(500);
		const spare = await join(joinCode, 'Spare'); // a kick re-checks; Bob is still in his grace
		await kickPlayer(gameId, spare.playerId);
		expect(await phaseOf(gameId)).toBe('round');
		await fx.clock.advance(goneAt + DISCONNECT_GRACE_MS - 1 - fx.clock.now);
		expect(await phaseOf(gameId)).toBe('round');
		await fx.clock.advance(1);
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds()).toEqual([expect.objectContaining({ reason: 'allLocked' })]);
	});

	it('nobody connected never ends a round early', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Ghost', { connected: false });
		await startRound(gameId);
		await place(a, 0, near(fx.locations[0]!, 1), { lock: true });
		expect(await phaseOf(gameId)).toBe('round');
	});

	it('kicking the last unlocked player ends the round; kicked players are gone and cannot rejoin', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Good');
		const b = await join(joinCode, 'Rude');
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 2), { lock: true });
		await place(b, 0, near(l0, 0), { lock: false });
		const spare = await join(joinCode, 'Spare');
		await kickPlayer(gameId, spare.playerId);
		expect(await phaseOf(gameId)).toBe('round'); // still waiting for Rude
		await expectGameError(place(spare, 0, near(l0, 0)), 'KICKED');
		await kickPlayer(gameId, b.playerId);
		const host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.players.map((p) => p.nickname)).toEqual(['Good']);
		expect(host.result.winnerPlayerIds).toEqual([a.playerId]); // Rude was closer but is out
		expect(host.result.guesses.map((g) => g.playerId)).toEqual([a.playerId]);
		expect(host.standings.map((s) => s.playerId)).toEqual([a.playerId]);
		expect(await buildPlayerStateForGame(gameId, b.token)).toEqual({ role: 'player', status: 'kicked' });
		await expectGameError(joinGame({ code: joinCode, nickname: 'Rude2' }, b.token), 'KICKED');
		// Late updates after the round ended are ignored.
		await expect(updateGuess(a.player, { gameId, roundIndex: 0, lat: 0, lng: 0, touched: true })).resolves.toBeUndefined();
		await expectGameError(kickPlayer(gameId, '00000000-0000-4000-8000-000000000000'), 'NOT_FOUND');
	});
});

describe('joining', () => {
	it('unique case-insensitive nicknames, colours, rejoin by token, late join spectates', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode.toLowerCase(), 'Mia');
		await expectGameError(joinGame({ code: joinCode, nickname: 'mIA' }, null), 'NICKNAME_TAKEN');
		const again = await joinGame({ code: joinCode, nickname: 'Whatever' }, a.token);
		expect(again).toEqual({ gameId, playerId: a.playerId, joinCode, token: null });
		await expectGameError(joinGame({ code: 'ZZZZ', nickname: 'X' }, null), 'NOT_FOUND');

		const l0 = fx.locations[0]!;
		await startRound(gameId);
		fx.clock.now += 1000;
		const late = await join(joinCode, 'Late');
		const pl = await buildPlayerStateForGame(gameId, late.token);
		if (pl.status !== 'playing' || pl.phase !== 'round') throw new Error('expected round');
		expect(pl.canGuess).toBe(false);
		expect(pl.players.find((p) => p.id === late.playerId)?.lateJoiner).toBe(true);
		// Every role is told who is guessing this round: Mia, not the mid-round joiner.
		expect(pl.round.eligiblePlayerIds).toEqual([a.playerId]);
		const hostDuring = await buildHostSnapshot(gameId);
		if (hostDuring.phase !== 'round') throw new Error('expected round');
		expect(hostDuring.round.eligiblePlayerIds).toEqual([a.playerId]);
		await expectGameError(place(late, 0, near(l0, 0)), 'NOT_ELIGIBLE');
		// Mia alone decides the early finish; Late is not waited for.
		await place(a, 0, near(l0, 1), { lock: true });
		const host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.noGuessPlayerIds).toEqual([]);
		// The late joiner plays the next round.
		await nextRound(gameId);
		await nextRound(gameId);
		const pl2 = await buildPlayerStateForGame(gameId, late.token);
		expect(pl2.status === 'playing' && pl2.phase === 'round' && pl2.canGuess).toBe(true);
		if (pl2.status !== 'playing' || pl2.phase !== 'round') throw new Error('expected round');
		expect(pl2.round.eligiblePlayerIds).toEqual([a.playerId, late.playerId]);
	});

	it(`caps the game at ${MAX_PLAYERS} players and refuses joins after the game finished`, async () => {
		const { gameId, joinCode } = await newGame(1);
		const first = await join(joinCode, 'P0', { connected: false });
		expect(await isGameFull(gameId)).toBe(false);
		for (let i = 1; i < MAX_PLAYERS; i++) await joinGame({ code: joinCode, nickname: `P${i}` }, null);
		expect(await isGameFull(gameId)).toBe(true);
		await expectGameError(joinGame({ code: joinCode, nickname: 'One too many' }, null), 'GAME_FULL');
		const colours = await db.select({ c: player.color }).from(player).where(eq(player.gameId, gameId));
		expect(new Set(colours.map((r) => r.c)).size).toBe(MAX_PLAYERS);
		expect(await buildPlayerStateForGame(gameId, null)).toEqual({ role: 'player', status: 'notJoined', joinable: false });
		// Kicking frees a slot.
		await kickPlayer(gameId, first.playerId);
		expect(await isGameFull(gameId)).toBe(false);
		await joinGame({ code: joinCode, nickname: 'Replacement' }, null);
		await endGame(gameId);
		await expectGameError(joinGame({ code: joinCode, nickname: 'After' }, null), 'NOT_FOUND');
	});

	it('parallel joins with the same nickname: exactly one wins', async () => {
		const { joinCode } = await newGame(1);
		const results = await Promise.allSettled(
			Array.from({ length: 5 }, () => joinGame({ code: joinCode, nickname: 'Same' }, null))
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(
			results.every(
				(r) => r.status === 'fulfilled' || (r.reason instanceof GameError && r.reason.code === 'NICKNAME_TAKEN')
			)
		).toBe(true);
	});
});

describe('concurrency', () => {
	it('parallel lock-ins end the round exactly once', async () => {
		const { gameId, joinCode } = await newGame(1);
		const players: Joined[] = [];
		for (let i = 0; i < 8; i++) players.push(await join(joinCode, `Par${i}`));
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await Promise.all(players.map((p, i) => place(p, 0, near(l0, i + 1), { lock: true })));
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds()).toHaveLength(1);
		const host = await buildHostSnapshot(gameId);
		expect(host.phase === 'reveal' && host.result.winnerPlayerIds).toEqual([players[0]!.playerId]);
	});

	it('double lock-in by one player: one succeeds, the other is ALREADY_LOCKED', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Double');
		await join(joinCode, 'Waiting');
		await startRound(gameId);
		const l0 = fx.locations[0]!;
		const results = await Promise.allSettled([
			place(a, 0, near(l0, 1), { lock: true }),
			place(a, 0, near(l0, 2), { lock: true })
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
		expect(rejected.reason).toMatchObject({ code: 'ALREADY_LOCKED' });
	});

	it('simultaneous host end-round calls and the timer: exactly one transition, no errors', async () => {
		const { gameId, joinCode } = await newGame(2);
		await join(joinCode, 'Racer');
		await startRound(gameId);
		fx.clock.now += TIMER_S * 1000 + ROUND_END_GRACE_MS; // timer is due
		const seen = await current(gameId); // what the host tabs show: the running round
		await Promise.all([
			engineEndRoundNow(gameId, seen),
			engineEndRoundNow(gameId, seen),
			fx.clock.advance(0),
			engineEndRoundNow(gameId, seen)
		]);
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds()).toHaveLength(1);
		await expectGameError(startRound(gameId), 'WRONG_PHASE');
	});
});

describe('duplicate host commands (two tabs, retried requests)', () => {
	const phases = () => events.filter((e) => e.type === 'phase').map((e) => e.type === 'phase' && e.phase);

	it('two concurrent nextRound calls from the reveal make exactly one transition', async () => {
		const { gameId, joinCode } = await newGame(3);
		await join(joinCode, 'Twice');
		await startRound(gameId);
		await endRoundNow(gameId);
		const fromReveal = await current(gameId);
		expect(fromReveal).toEqual({ phase: 'reveal', roundIndex: 0 });
		events = [];
		await Promise.all([engineNextRound(gameId, fromReveal), engineNextRound(gameId, fromReveal)]);
		expect(await phaseOf(gameId)).toBe('standings'); // not skipped to round 2
		expect(phases()).toEqual(['standings']);
		// A late retry of the same request changes nothing either.
		await engineNextRound(gameId, fromReveal);
		expect(phases()).toEqual(['standings']);

		const fromStandings = await current(gameId);
		await Promise.all([engineNextRound(gameId, fromStandings), engineNextRound(gameId, fromStandings)]);
		expect(phases()).toEqual(['standings', 'round']);
		expect(events.filter((e) => e.type === 'roundStarted')).toHaveLength(1);
		const host = await buildHostSnapshot(gameId);
		expect(host.phase === 'round' && host.round.index).toBe(1);
	});

	it('stale start, end-round and skip commands do not touch a later state', async () => {
		const { gameId, joinCode } = await newGame(3);
		await join(joinCode, 'Stale');
		const fromLobby = await current(gameId);
		await engineStartRound(gameId, fromLobby);
		await engineStartRound(gameId, fromLobby); // retried: no-op, no WRONG_PHASE
		const inRound0 = await current(gameId);
		await engineEndRoundNow(gameId, inRound0);
		const inReveal0 = await current(gameId);
		await nextRound(gameId);
		await nextRound(gameId); // round 1 running
		events = [];
		await engineEndRoundNow(gameId, inRound0); // pressed during round 0, arrives in round 1
		await engineSkipReveal(gameId, inReveal0);
		expect(await phaseOf(gameId)).toBe('round');
		expect(events).toEqual([]);
		await endRoundNow(gameId);
		await engineSkipReveal(gameId, inReveal0); // the skip from reveal 0 does not skip reveal 1
		const host = await buildHostSnapshot(gameId);
		expect(host.phase === 'reveal' && [host.result.round.index, host.result.skipped]).toEqual([1, false]);
		// A command whose expectation holds but that makes no sense there is still refused.
		await expectGameError(engineStartRound(gameId, await current(gameId)), 'WRONG_PHASE');
	});
});

describe('snapshots during transitions', () => {
	it('never see a torn state while a round ends', async () => {
		const { gameId, joinCode } = await newGame(3);
		const a = await join(joinCode, 'Reader');
		for (let i = 0; i < 3; i++) {
			await startRoundOrNext(gameId, i);
			await place(a, i, near(fx.locations[i]!, 1));
			const reads = () => Array.from({ length: 12 }, () => buildHostSnapshot(gameId));
			const results = await Promise.allSettled([...reads(), endRoundNow(gameId), ...reads()]);
			const failed = results.filter((r) => r.status === 'rejected');
			expect(failed.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
			for (const r of results.slice(0, 12).concat(results.slice(13))) {
				const s = (r as PromiseFulfilledResult<HostSnapshot>).value;
				expect(['round', 'reveal']).toContain(s.phase);
			}
		}
	});

	it('a failed model build is not cached for the other streams of the game', async () => {
		const { gameId, joinCode } = await newGame(1);
		await join(joinCode, 'Streamer');
		const unsubscribe = subscribeGame(gameId, () => {}); // as if a stream were open
		try {
			vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('connection reset'));
			await expect(buildHostSnapshot(gameId)).rejects.toThrow('connection reset');
			// Same game version: the next stream builds afresh instead of getting the failure.
			expect((await buildHostSnapshot(gameId)).phase).toBe('lobby');
		} finally {
			unsubscribe();
		}
	});

	it('player and TV snapshots of one game version need no queries beyond the shared model', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Ada');
		const b = await join(joinCode, 'Ben');
		const late = await join(joinCode, 'Cy');
		const reg = await registerTv(null);
		fx.tvIds.push(reg.tvId);
		const pairing = await buildTvState(reg.token);
		if (pairing.status !== 'pairing') throw new Error('expected pairing');
		await pairTv(gameId, pairing.pairingCode);
		await startRound(gameId);
		const aPos = { lat: 12.345678, lng: 23.456789 };
		await place(a, 0, aPos);
		await place(b, 0, { lat: -5.5, lng: 7.25 }, { lock: true });
		await kickPlayer(gameId, late.playerId);
		const tvRow = (await resolveTv(reg.token))!;

		const unsubscribe = subscribeGame(gameId, () => {}); // streams are open: the model is shared
		try {
			await buildHostSnapshot(gameId); // builds the model for this version
			const select = vi.spyOn(db, 'select');
			const tx = vi.spyOn(db, 'transaction');
			const [pa, pb, pl, stranger] = await Promise.all([
				buildPlayerStateForGame(gameId, a.token),
				buildPlayerStateForGame(gameId, b.token),
				buildPlayerStateForGame(gameId, late.token),
				buildPlayerStateForGame(gameId, 'x'.repeat(43))
			]);
			const tv = await buildTvStateFor(tvRow);
			expect(select).not.toHaveBeenCalled();
			expect(tx).not.toHaveBeenCalled();

			if (pa.status !== 'playing' || pa.phase !== 'round') throw new Error('expected round');
			if (pb.status !== 'playing' || pb.phase !== 'round') throw new Error('expected round');
			expect(pa.me.id).toBe(a.playerId);
			expect(pa.myGuess).toMatchObject({ ...aPos, touched: true, lockedAt: null });
			expect(pb.myGuess).toMatchObject({ lat: -5.5, lng: 7.25, lockedAt: fx.clock.now });
			expect(pb.lockedPlayerIds).toEqual([b.playerId]);
			expect(JSON.stringify(pb)).not.toContain('12.345678'); // never another player's cross
			expect(pl).toEqual({ role: 'player', status: 'kicked' });
			expect(stranger).toEqual({ role: 'player', status: 'notJoined', joinable: true });
			expect(tv.status === 'paired' && tv.phase).toBe('round');
		} finally {
			unsubscribe();
		}
	});

	it('a phone that reconnects after moving its cross gets the new position', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Mover');
		await join(joinCode, 'Other');
		await startRound(gameId);
		await place(a, 0, { lat: 1, lng: 1 });
		const unsubscribe = subscribeGame(gameId, () => {});
		try {
			const before = await buildPlayerStateForGame(gameId, a.token);
			expect(before.status === 'playing' && before.phase === 'round' && before.myGuess).toMatchObject({ lat: 1 });
			await place(a, 0, { lat: 2, lng: 3 }); // no notification: nobody else may see it
			const after = await buildPlayerStateForGame(gameId, a.token);
			expect(after.status === 'playing' && after.phase === 'round' && after.myGuess).toMatchObject({ lat: 2, lng: 3 });
		} finally {
			unsubscribe();
		}
	});

	async function startRoundOrNext(gameId: string, i: number) {
		if (i === 0) return startRound(gameId);
		await nextRound(gameId);
		await nextRound(gameId);
	}
});

describe('restart recovery', () => {
	it('re-arms a running round and ends an overdue one at boot', async () => {
		const running = await newGame(1);
		const overdue = await newGame(1);
		const a = await join(running.joinCode, 'Run');
		await join(overdue.joinCode, 'Due');
		await startRound(overdue.gameId);
		fx.clock.now += 20_000;
		await startRound(running.gameId);
		await place(a, 0, near(fx.locations[0]!, 1));

		// "Crash": all in-memory timers are lost.
		resetEngineMemory();
		expect(armedRoundTimers().size).toBe(0);
		fx.clock.now += 15_000; // overdue's deadline (30 s) has passed, running's has not

		await initEngine({ gameIds: [running.gameId, overdue.gameId] });
		expect(await phaseOf(overdue.gameId)).toBe('reveal');
		expect(await phaseOf(running.gameId)).toBe('round');
		expect(armedRoundTimers().has(running.gameId)).toBe(true);

		await fx.clock.advance(15_000 + ROUND_END_GRACE_MS);
		expect(await phaseOf(running.gameId)).toBe('reveal');
		const host = await buildHostSnapshot(running.gameId);
		expect(host.phase === 'reveal' && host.result.winnerPlayerIds).toEqual([a.playerId]);
	});

	it('gives phones a grace period to reconnect before the early-finish rule applies', async () => {
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'First', { connected: false });
		await join(joinCode, 'Second', { connected: false });
		await startRound(gameId);
		resetEngineMemory();
		await initEngine({ gameIds: [gameId] });
		// Only the locked player is back so far: no early finish during the grace period.
		presence.push(enterPresence(gameId, `player:${a.playerId}`));
		await place(a, 0, near(fx.locations[0]!, 1), { lock: true });
		expect(await phaseOf(gameId)).toBe('round');
		await fx.clock.advance(10_000);
		expect(await phaseOf(gameId)).toBe('reveal'); // Second never came back
	});
});

describe('database failures', () => {
	it('a round timer that fails to end the round retries with backoff', async () => {
		const { gameId, joinCode } = await newGame(1);
		await join(joinCode, 'Patient');
		await startRound(gameId);
		const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
		const tx = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('connection reset'));
		await fx.clock.advance(TIMER_S * 1000 + ROUND_END_GRACE_MS);
		expect(tx).toHaveBeenCalledTimes(1);
		expect(quiet).toHaveBeenCalled();
		expect(await phaseOf(gameId)).toBe('round'); // the blip
		expect(armedRoundTimers().get(gameId)).toBeDefined(); // ... but the timer is armed again
		await fx.clock.advance(RETRY_BASE_MS);
		expect(await phaseOf(gameId)).toBe('reveal');
		expect(roundEnds()).toEqual([expect.objectContaining({ reason: 'timer' })]);
		expect(armedRoundTimers().has(gameId)).toBe(false);
	});

	it('a failed engine start is retried until it succeeds', async () => {
		const { gameId, joinCode } = await newGame(1);
		await join(joinCode, 'Booter');
		await startRound(gameId);
		resetEngineMemory(); // "restart"
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(db, 'select').mockImplementationOnce(() => {
			throw new Error('database not up yet');
		});
		await startEngine({ gameIds: [gameId] });
		expect(armedRoundTimers().has(gameId)).toBe(false);
		await fx.clock.advance(RETRY_BASE_MS);
		expect(armedRoundTimers().has(gameId)).toBe(true);
		await fx.clock.advance(TIMER_S * 1000);
		expect(await phaseOf(gameId)).toBe('reveal');
	});
});

describe('endGame', () => {
	it('from the lobby, mid-round (unscored) and with a clear leader', async () => {
		const lobby = await newGame(2);
		await endGame(lobby.gameId);
		let host: HostSnapshot = await buildHostSnapshot(lobby.gameId);
		expect(host.phase === 'finished' && [host.endedEarly, host.winnerPlayerIds]).toEqual([true, []]);
		await endGame(lobby.gameId); // idempotent

		const mid = await newGame(3);
		const a = await join(mid.joinCode, 'Lead');
		const b = await join(mid.joinCode, 'Trail');
		const [l0, l1] = fx.locations;
		await startRound(mid.gameId);
		await place(a, 0, near(l0!, 1));
		await place(b, 0, near(l0!, 2));
		await endRoundNow(mid.gameId);
		await nextRound(mid.gameId);
		await nextRound(mid.gameId);
		await place(b, 1, near(l1!, 0.1), { lock: true });
		await endGame(mid.gameId);
		expect(armedRoundTimers().has(mid.gameId)).toBe(false);
		host = await buildHostSnapshot(mid.gameId);
		if (host.phase !== 'finished') throw new Error('expected finished');
		expect(host.endedEarly).toBe(true);
		expect(host.winnerPlayerIds).toEqual([a.playerId]); // round 2 was not scored
		expect(host.standings.map((s) => [s.playerId, s.roundsWon])).toEqual([
			[a.playerId, 1],
			[b.playerId, 0]
		]);
		const detail = await getGameHistory(mid.gameId);
		expect(detail.endedEarly).toBe(true);
		expect(detail.rounds.map((r) => r.winnerPlayerIds)).toEqual([[a.playerId], []]);
	});
});

describe('teams', () => {
	async function newTeamsGame(rounds: number, teams: { count: number; pick?: boolean; names?: string[] }) {
		const r = await createGame({
			playlistId: fx.playlistId,
			roundCount: rounds,
			selection: 'first',
			shuffle: false,
			timerSeconds: TIMER_S,
			language: 'en',
			teams: true,
			teamCount: teams.count,
			teamNames: teams.names,
			teamPick: teams.pick ?? false
		});
		fx.gameIds.push(r.gameId);
		return r;
	}

	async function joinTeam(code: string, nickname: string, team?: number) {
		fx.clock.now += 1;
		const r = await joinGame({ code, nickname, team }, null);
		const p = (await resolvePlayer(r.gameId, r.token))!;
		presence.push(enterPresence(r.gameId, `player:${p.id}`));
		return { ...r, token: r.token!, player: p };
	}

	async function gameRow(gameId: string) {
		const [g] = await db.select().from(game).where(eq(game.id, gameId));
		return g!;
	}

	it('creating a teams game stores its settings; without teams they are ignored', async () => {
		const t = await newTeamsGame(2, { count: 3, pick: true, names: [' Red ', '', 'Blue', 'Extra'] });
		expect(await gameRow(t.gameId)).toMatchObject({
			teamCount: 3,
			teamNames: ['Red', '', 'Blue'],
			teamPick: true,
			winnerTeams: []
		});
		const short = await newTeamsGame(2, { count: 2 });
		expect(await gameRow(short.gameId)).toMatchObject({ teamCount: 2, teamNames: ['', ''], teamPick: false });

		const off = await createGame({
			playlistId: fx.playlistId,
			roundCount: 2,
			selection: 'first',
			shuffle: false,
			timerSeconds: TIMER_S,
			language: 'en',
			teams: false,
			teamCount: 4,
			teamNames: ['X'],
			teamPick: true
		});
		fx.gameIds.push(off.gameId);
		expect(await gameRow(off.gameId)).toMatchObject({ teamCount: null, teamNames: [], teamPick: false });

		const host = await buildHostSnapshot(t.gameId);
		expect(host.game.teams).toEqual([
			{ index: 0, name: 'Red' },
			{ index: 1, name: null },
			{ index: 2, name: 'Blue' }
		]);
		expect(host.game.teamPick).toBe(true);
	});

	it('auto-assignment balances the teams, also after a kick and for late joiners', async () => {
		const { gameId, joinCode } = await newTeamsGame(2, { count: 2 });
		const joined = [];
		for (const name of ['P1', 'P2', 'P3', 'P4']) joined.push(await joinTeam(joinCode, name, 1));
		expect(joined.map((j) => j.player.team)).toEqual([0, 1, 0, 1]);

		await kickPlayer(gameId, joined[0]!.playerId);
		const late = await joinTeam(joinCode, 'P5');
		expect(late.player.team).toBe(0);

		await startRound(gameId);
		const mid = await joinTeam(joinCode, 'P6'); // 2 v 2 again → lowest index, mid-round
		expect(mid.player.team).toBe(0);
		const next = await joinTeam(joinCode, 'P7');
		expect(next.player.team).toBe(1);
		const host = await buildHostSnapshot(gameId);
		expect(host.players.map((p) => [p.nickname, p.team])).toEqual([
			['P2', 1],
			['P3', 0],
			['P4', 1],
			['P5', 0],
			['P6', 0],
			['P7', 1]
		]);
		const me = await buildPlayerStateForGame(gameId, mid.token);
		expect(me.status === 'playing' && me.me.team).toBe(0);
		expect(me.status === 'playing' && me.phase === 'round' && me.canGuess).toBe(false);
	});

	it('picking requires a valid team; rejoining keeps the team; games without teams ignore it', async () => {
		const { joinCode } = await newTeamsGame(2, { count: 3, pick: true });
		await expectGameError(joinGame({ code: joinCode, nickname: 'NoTeam' }, null), 'TEAM_REQUIRED');
		await expectGameError(joinGame({ code: joinCode, nickname: 'Far', team: 3 }, null), 'TEAM_REQUIRED');
		const blue = await joinTeam(joinCode, 'Blue', 2);
		expect(blue.player.team).toBe(2);
		const again = await joinGame({ code: joinCode, nickname: 'Other', team: 0 }, blue.token);
		expect(again.playerId).toBe(blue.playerId);
		expect((await resolvePlayer(blue.gameId, blue.token))!.team).toBe(2);

		const plain = await newGame(2);
		const p = await joinTeam(plain.joinCode, 'Plain', 1);
		expect(p.player.team).toBeNull();
	});

	it('a team takes the round through its closest player', async () => {
		const { gameId, joinCode } = await newTeamsGame(2, { count: 2, pick: true, names: ['Red', ''] });
		const a = await joinTeam(joinCode, 'Ann', 0);
		const b = await joinTeam(joinCode, 'Bob', 1);
		const c = await joinTeam(joinCode, 'Cat', 0);
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 2));
		await place(b, 0, near(l0, 0.2));
		await place(c, 0, near(l0, 3));
		await endRoundNow(gameId);

		const host = await buildHostSnapshot(gameId);
		if (host.phase !== 'reveal') throw new Error('expected reveal');
		expect(host.result.winnerPlayerIds).toEqual([b.playerId]);
		expect(host.result.winnerTeams).toEqual([1]);
		expect(host.teamStandings!.map((r) => [r.team, r.name, r.rank, r.roundsWon])).toEqual([
			[1, null, 1, 1],
			[0, 'Red', 2, 0]
		]);
		expect(host.teamStandings![1]!.members.map((m) => m.playerId)).toEqual([a.playerId, c.playerId]);

		const pa = await buildPlayerStateForGame(gameId, a.token);
		const pb = await buildPlayerStateForGame(gameId, b.token);
		expect(pa.status === 'playing' && pa.phase === 'reveal' && pa.myResult).toMatchObject({ won: false, teamWon: false });
		expect(pb.status === 'playing' && pb.phase === 'reveal' && pb.myResult).toMatchObject({ won: true, teamWon: true });
	});

	async function tiedTeamsGame() {
		// Team 0: Ann, Dan · team 1: Bob · team 2: Cat. Ann and Bob win a round each.
		const { gameId, joinCode } = await newTeamsGame(2, { count: 3, pick: true });
		const a = await joinTeam(joinCode, 'Ann', 0);
		const b = await joinTeam(joinCode, 'Bob', 1);
		const c = await joinTeam(joinCode, 'Cat', 2);
		const d = await joinTeam(joinCode, 'Dan', 0);
		const [l0, l1] = fx.locations;
		await startRound(gameId);
		await place(a, 0, near(l0!, 0.1));
		await place(b, 0, near(l0!, 2));
		await place(c, 0, near(l0!, 3));
		await endRoundNow(gameId);
		await nextRound(gameId);
		await nextRound(gameId);
		await place(a, 1, near(l1!, 2));
		await place(b, 1, near(l1!, 0.1));
		await place(d, 1, near(l1!, 3));
		await endRoundNow(gameId);
		await nextRound(gameId);
		return { gameId, a, b, c, d };
	}

	it('a tie at the end starts sudden death with exactly the active members of the tied teams', async () => {
		const { gameId, a, b, c, d } = await tiedTeamsGame();
		let host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({
			kind: 'suddenDeath',
			eligiblePlayerIds: [a.playerId, d.playerId, b.playerId],
			teams: [0, 1]
		});

		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'round') throw new Error('expected round');
		expect(host.round.isSuddenDeath).toBe(true);
		expect(host.round.eligiblePlayerIds).toEqual([a.playerId, d.playerId, b.playerId]);
		const [sd] = await db
			.select()
			.from(gameRound)
			.where(and(eq(gameRound.gameId, gameId), eq(gameRound.isSuddenDeath, true)));
		expect(sd!.eligiblePlayerIds).toEqual([a.playerId, d.playerId, b.playerId]);
		const pc = await buildPlayerStateForGame(gameId, c.token);
		expect(pc.status === 'playing' && pc.phase === 'round' && pc.canGuess).toBe(false);
		const late = await joinTeam((await gameRow(gameId)).joinCode, 'Late', 0);
		const pl = await buildPlayerStateForGame(gameId, late.token);
		expect(pl.status === 'playing' && pl.phase === 'round' && pl.canGuess).toBe(false);

		// Dan (team 0) is closest: team 0 wins.
		const loc = fx.locations.find((l) => l.id === sd!.locationId)!;
		await place(a, 2, near(loc, 2), { lock: true });
		await place(d, 2, near(loc, 0.1), { lock: true });
		await place(b, 2, near(loc, 1), { lock: true });
		host = await buildHostSnapshot(gameId);
		expect(host.phase === 'reveal' && host.result.winnerTeams).toEqual([0]);
		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'standings') throw new Error('expected standings');
		expect(host.next).toEqual({
			kind: 'finish',
			winnerPlayerIds: [a.playerId, d.playerId, late.playerId],
			winnerTeams: [0]
		});
		await nextRound(gameId);
		host = await buildHostSnapshot(gameId);
		if (host.phase !== 'finished') throw new Error('expected finished');
		expect(host.winnerTeams).toEqual([0]);
		expect(host.teamStandings!.map((r) => [r.team, r.roundsWon])).toEqual([
			[0, 2],
			[1, 1],
			[2, 0]
		]);
		expect((await gameRow(gameId)).winnerTeams).toEqual([0]);
	});

	it('endGame gives the win to the leading team', async () => {
		const { gameId, joinCode } = await newTeamsGame(3, { count: 2, pick: true });
		const a = await joinTeam(joinCode, 'Ann', 0);
		const b = await joinTeam(joinCode, 'Bob', 1);
		const c = await joinTeam(joinCode, 'Cat', 1);
		const l0 = fx.locations[0]!;
		await startRound(gameId);
		await place(a, 0, near(l0, 2));
		await place(b, 0, near(l0, 3));
		await place(c, 0, near(l0, 0.5));
		await endRoundNow(gameId);
		await nextRound(gameId);
		await nextRound(gameId);
		await endGame(gameId);
		const host = await buildHostSnapshot(gameId);
		if (host.phase !== 'finished') throw new Error('expected finished');
		expect(host.endedEarly).toBe(true);
		expect(host.winnerTeams).toEqual([1]);
		expect(host.winnerPlayerIds).toEqual([b.playerId, c.playerId]);
		const tv = await buildPlayerStateForGame(gameId, a.token);
		expect(tv.status === 'playing' && tv.phase === 'finished' && tv.winnerTeams).toEqual([1]);
	});

	it('snapshots of a game without teams contain none of the team keys', async () => {
		const TEAM_KEYS = ['teams', 'teamPick', 'team', 'winnerTeams', 'teamStandings', 'teamWon'];
		const keysOf = (value: unknown, out = new Set<string>()): Set<string> => {
			if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
			else if (value && typeof value === 'object') {
				for (const [k, v] of Object.entries(value)) {
					out.add(k);
					keysOf(v, out);
				}
			}
			return out;
		};
		const seen = new Set<string>();
		const collect = async (gameId: string, token: string) => {
			keysOf(await buildHostSnapshot(gameId), seen);
			keysOf(await buildPlayerStateForGame(gameId, token), seen);
		};
		const { gameId, joinCode } = await newGame(1);
		const a = await join(joinCode, 'Solo');
		await collect(gameId, a.token);
		await startRound(gameId);
		await collect(gameId, a.token);
		await place(a, 0, near(fx.locations[0]!, 1));
		await endRoundNow(gameId);
		await collect(gameId, a.token);
		await nextRound(gameId);
		await collect(gameId, a.token);
		await nextRound(gameId);
		await collect(gameId, a.token);
		expect(seen.has('winnerPlayerIds')).toBe(true);
		expect(TEAM_KEYS.filter((k) => seen.has(k))).toEqual([]);
	});
});

describe('TV pairing', () => {
	it('register → pairing code → paired → finished with next code → next game', async () => {
		const unregistered = await buildTvState(null);
		expect(unregistered).toEqual({ role: 'tv', status: 'unregistered' });

		const reg = await registerTv(null);
		fx.tvIds.push(reg.tvId);
		expect(reg.token).toBeTruthy();
		expect(await registerTv(reg.token)).toEqual({ tvId: reg.tvId, token: null });

		let tv = await buildTvState(reg.token);
		if (tv.status !== 'pairing') throw new Error('expected pairing');
		expect(tv.pairingCode).toMatch(/^\d{6}$/);
		expect(tv.codeExpiresAt).toBe(fx.clock.now + PAIRING_CODE_TTL_MS);
		const firstCode = tv.pairingCode;

		// Rotates after expiry.
		fx.clock.now += PAIRING_CODE_TTL_MS;
		tv = await buildTvState(reg.token);
		if (tv.status !== 'pairing') throw new Error('expected pairing');
		expect(tv.codeExpiresAt).toBe(fx.clock.now + PAIRING_CODE_TTL_MS);
		const code = tv.pairingCode;

		const g1 = await newGame(1);
		await expectGameError(pairTv(g1.gameId, code === '000000' ? '000001' : '000000'), 'INVALID_PAIRING_CODE');
		if (firstCode !== code) await expectGameError(pairTv(g1.gameId, firstCode), 'INVALID_PAIRING_CODE');
		await pairTv(g1.gameId, code);
		tv = await buildTvState(reg.token);
		expect(tv.status === 'paired' && [tv.phase, tv.game.id, tv.nextPairing]).toEqual(['lobby', g1.gameId, undefined]);
		const host = await buildHostSnapshot(g1.gameId);
		expect(host.tv).toEqual({ paired: true, connected: false });
		const leave = enterPresence(g1.gameId, `tv:${reg.tvId}`);
		expect((await buildHostSnapshot(g1.gameId)).tv).toEqual({ paired: true, connected: true });
		leave();
		await expectGameError(pairTv(g1.gameId, code), 'INVALID_PAIRING_CODE'); // code consumed

		await endGame(g1.gameId);
		tv = await buildTvState(reg.token);
		if (tv.status !== 'paired' || tv.phase !== 'finished') throw new Error('expected finished');
		expect(tv.nextPairing?.pairingCode).toMatch(/^\d{6}$/);
		await expectGameError(pairTv(g1.gameId, tv.nextPairing!.pairingCode), 'WRONG_PHASE');

		const g2 = await newGame(1);
		await pairTv(g2.gameId, tv.nextPairing!.pairingCode);
		tv = await buildTvState(reg.token);
		expect(tv.status === 'paired' && tv.game.id).toBe(g2.gameId);
		expect((await resolveTv(reg.token))?.pairingCode).toBeNull();
	});
});

describe('the answer never leaks before reveal', () => {
	it('player, host and TV snapshots during a round contain no target or other guesses', async () => {
		const { gameId, joinCode } = await newGame(2);
		const a = await join(joinCode, 'Leaky');
		const b = await join(joinCode, 'Other');
		const reg = await registerTv(null);
		fx.tvIds.push(reg.tvId);
		const pairing = await buildTvState(reg.token);
		if (pairing.status !== 'pairing') throw new Error('expected pairing');
		await pairTv(gameId, pairing.pairingCode);
		const l0 = fx.locations[0]!;
		// A photo whose credit and source name the place (typical for Wikimedia imports).
		const fileKey = await addPhoto(fx, l0, {
			attribution: `${l0.name} by CreditMarker, CC BY-SA 4.0`,
			sourceUrl: `https://commons.example.org/wiki/File:${l0.name}_SourceMarker.jpg`
		});
		// The admin's start view goes to the players (only), from its own columns.
		const startView = { lat: 47.123987, lng: 9.456321, zoom: 4.25 };
		await db
			.update(location)
			.set({ startLat: startView.lat, startLng: startView.lng, startZoom: startView.zoom })
			.where(eq(location.id, l0.id));
		await startRound(gameId);
		// Bob's distinctive cross must not reach Alice (or the TV/host) either.
		const bobPos = { lat: 33.987123, lng: -44.876543 };
		await place(b, 0, bobPos, { lock: true });
		await place(a, 0, { lat: 1.5, lng: 2.5 });

		const snapshots = [
			await buildPlayerStateForGame(gameId, a.token),
			await buildPlayerStateForGame(gameId, b.token),
			await buildHostSnapshot(gameId),
			await buildTvState(reg.token)
		];
		const forbidden = [
			String(l0.lat),
			String(l0.lng),
			l0.name,
			l0.fact,
			`${l0.name}Sv`,
			`${l0.fact}Sv`,
			'CreditMarker',
			'SourceMarker',
			'987123',
			'876543'
		];
		for (const s of snapshots) {
			const json = JSON.stringify(s);
			expect(json).toContain(l0.clue); // sanity: it is the right round
			expect(json).toContain(`/media/${fileKey}/md.webp`); // the photo is there, by random key
			for (const f of forbidden.slice(0, 8)) expect(json).not.toContain(f);
			expect(json).not.toContain('"attribution"');
			expect(json).not.toContain('"sourceUrl"');
			if (!(s.role === 'player' && s.status === 'playing' && s.me.id === b.playerId)) {
				for (const f of forbidden.slice(6)) expect(json).not.toContain(f);
			}
			expect(json).not.toContain('"result"');
			expect(json).not.toContain('"target"');
			if (s.role === 'player') {
				if (s.status !== 'playing' || s.phase !== 'round') throw new Error('expected a round');
				expect(s.startView).toEqual(startView);
			} else {
				expect(json).not.toContain('"startView"');
				expect(json).not.toContain('123987');
			}
		}

		// Once revealed, the answer is there, and the photo credit with it.
		await endRoundNow(gameId);
		const tv = await buildTvState(reg.token);
		const json = JSON.stringify(tv);
		expect(json).toContain(l0.name);
		expect(json).toContain(l0.fact);
		expect(json).toContain(String(l0.lat));
		if (tv.status !== 'paired' || tv.phase !== 'reveal') throw new Error('expected reveal');
		expect(tv.result.round.clue.photo).toMatchObject({
			attribution: expect.stringContaining('CreditMarker'),
			sourceUrl: expect.stringContaining('SourceMarker'),
			urls: { md: `/media/${fileKey}/md.webp` }
		});
	});
});
