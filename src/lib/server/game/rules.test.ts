import { describe, expect, it } from 'vitest';
import {
	computeStandings,
	computeTeamStandings,
	countsAsGuess,
	currentWinners,
	currentWinnerTeams,
	decideNextStep,
	decideTeamNextStep,
	haversineKm,
	leaders,
	pickRandom,
	pickRoundLocations,
	roundWinnerTeams,
	scoreRound,
	shuffled,
	type GuessRecord,
	type RoundOutcome
} from './rules.ts';

const LOCKED = new Date(0);
const g = (playerId: string, lat: number, lng: number, opts: Partial<GuessRecord> = {}): GuessRecord => ({
	playerId,
	lat,
	lng,
	touched: true,
	lockedAt: null,
	...opts
});

/** Deterministic rng (mulberry32). */
function rng(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe('countsAsGuess', () => {
	it('counts locked or touched guesses only', () => {
		expect(countsAsGuess({ touched: false, lockedAt: null })).toBe(false);
		expect(countsAsGuess({ touched: true, lockedAt: null })).toBe(true);
		expect(countsAsGuess({ touched: false, lockedAt: LOCKED })).toBe(true);
	});
});

describe('scoreRound', () => {
	const target = { lat: 59.3293, lng: 18.0686 }; // Stockholm

	it('gives the round to the closest counting guess', () => {
		const s = scoreRound(
			target,
			[g('a', 59.9, 10.7), g('b', 55.7, 12.6), g('c', 48.85, 2.35, { lockedAt: LOCKED, touched: false })],
			['a', 'b', 'c'],
			null
		);
		expect(s.winnerPlayerIds).toEqual(['a']);
		expect(s.scored.map((x) => x.playerId)).toEqual(['a', 'b', 'c']);
		expect(s.scored.map((x) => x.rank)).toEqual([1, 2, 3]);
		expect(s.scored[0]!.isWinner).toBe(true);
		expect(s.scored[1]!.isWinner).toBe(false);
		expect(s.scored[0]!.distanceKm).toBeCloseTo(haversineKm(target, { lat: 59.9, lng: 10.7 }), 9);
		expect(s.noGuessPlayerIds).toEqual([]);
	});

	it('ignores untouched unlocked crosses (no guess, cannot win)', () => {
		const s = scoreRound(
			target,
			[g('a', 59.33, 18.07, { touched: false }), g('b', 0, 0)],
			['a', 'b'],
			null
		);
		expect(s.winnerPlayerIds).toEqual(['b']);
		expect(s.noGuessPlayerIds).toEqual(['a']);
	});

	it('scores nobody when every cross is untouched', () => {
		const s = scoreRound(
			target,
			[g('a', 59.33, 18.07, { touched: false }), g('b', 1, 1, { touched: false })],
			['a', 'b', 'c'],
			null
		);
		expect(s.scored).toEqual([]);
		expect(s.winnerPlayerIds).toEqual([]);
		expect(s.noGuessPlayerIds).toEqual(['a', 'b', 'c']);
	});

	it('shares the point on an exact tie and ranks 1, 1, 3', () => {
		const s = scoreRound(target, [g('b', 50, 10), g('a', 50, 10), g('c', 0, 0)], ['a', 'b', 'c'], null);
		expect(s.winnerPlayerIds.sort()).toEqual(['a', 'b']);
		expect(s.scored.map((x) => x.rank)).toEqual([1, 1, 3]);
	});

	it('handles a single player', () => {
		const s = scoreRound(target, [g('solo', -33.9, 151.2)], ['solo'], null);
		expect(s.winnerPlayerIds).toEqual(['solo']);
		expect(scoreRound(target, [], ['solo'], null)).toEqual({
			scored: [],
			winnerPlayerIds: [],
			noGuessPlayerIds: ['solo']
		});
	});

	it('measures across the antimeridian the short way, with wrapped longitudes', () => {
		const fiji = { lat: -17.7, lng: 179.9 };
		const s = scoreRound(
			fiji,
			[g('east', -17.7, -179.9), g('west', -17.7, 170), g('wrapped', -17.7, 180.1 + 360)],
			['east', 'west', 'wrapped'],
			null
		);
		const byId = Object.fromEntries(s.scored.map((x) => [x.playerId, x.distanceKm]));
		expect(byId.east!).toBeLessThan(25); // 0.2° of longitude, not 359.8°
		expect(byId.wrapped!).toBeLessThan(25);
		expect(byId.west!).toBeGreaterThan(1000);
		expect(byId.wrapped!).toBeCloseTo(byId.east!, 6);
		expect(s.winnerPlayerIds).not.toContain('west');
	});

	it('only counts eligible players (sudden death) and ignores kicked players', () => {
		const guesses = [g('a', 59.3, 18.0), g('b', 50, 10), g('c', 59.33, 18.07), g('kicked', 59.3293, 18.0686)];
		const s = scoreRound(target, guesses, ['a', 'b', 'c'], ['a', 'b', 'kicked']);
		expect(s.winnerPlayerIds).toEqual(['a']);
		expect(s.scored.map((x) => x.playerId)).toEqual(['a', 'b']);
		expect(s.noGuessPlayerIds).toEqual([]);
	});

	it('treats a late joiner (not in the eligible list) as a spectator', () => {
		const s = scoreRound(target, [g('early', 0, 0), g('late', 59.3293, 18.0686)], ['early', 'late'], ['early']);
		expect(s.winnerPlayerIds).toEqual(['early']);
		expect(s.noGuessPlayerIds).toEqual([]);
	});

	it('uses only the first guess per player', () => {
		const s = scoreRound(target, [g('a', 0, 0), g('a', 59.3293, 18.0686)], ['a'], null);
		expect(s.scored).toHaveLength(1);
		expect(s.scored[0]!.distanceKm).toBeGreaterThan(1000);
	});
});

describe('computeStandings / leaders', () => {
	const players = [
		{ id: 'a', nickname: 'A', color: '#000001' },
		{ id: 'b', nickname: 'B', color: '#000002' },
		{ id: 'c', nickname: 'C', color: '#000003' }
	];
	const round = (winners: string[], d: Record<string, number>): RoundOutcome => ({
		winnerPlayerIds: winners,
		distances: new Map(Object.entries(d))
	});

	it('orders by rounds won and shares ranks', () => {
		const rows = computeStandings(players, [
			round(['b'], { a: 100, b: 10, c: 50 }),
			round(['a'], { a: 5, b: 20 }),
			round(['b'], { b: 1, c: 2 })
		]);
		expect(rows.map((r) => [r.playerId, r.roundsWon, r.rank])).toEqual([
			['b', 2, 1],
			['a', 1, 2],
			['c', 0, 3]
		]);
		expect(rows[0]!.totalDistanceKm).toBe(31);
		expect(rows[0]!.guessedRounds).toBe(3);
		expect(rows[2]!.guessedRounds).toBe(2);
	});

	it('ties share a rank; display order prefers more guessed rounds, then less distance', () => {
		const rows = computeStandings(players, [round(['a', 'b'], { a: 10, b: 10, c: 20 }), round([], { a: 30, c: 5 })]);
		expect(rows.map((r) => [r.playerId, r.rank])).toEqual([
			['a', 1],
			['b', 1],
			['c', 3]
		]);
		expect(leaders(rows).sort()).toEqual(['a', 'b']);
	});

	it('handles no players and players without guesses', () => {
		expect(computeStandings([], [round(['x'], { x: 1 })])).toEqual([]);
		expect(leaders([])).toEqual([]);
		const rows = computeStandings(players, []);
		expect(rows.every((r) => r.rank === 1 && r.roundsWon === 0 && r.totalDistanceKm === 0)).toBe(true);
		expect(currentWinners(rows)).toEqual([]);
	});
});

describe('decideNextStep', () => {
	const st = (won: Record<string, number>) => Object.entries(won).map(([playerId, roundsWon]) => ({ playerId, roundsWon }));

	it('plays the next regular round while rounds remain', () => {
		expect(
			decideNextStep({ regularRoundsPlayed: 2, totalRounds: 5, standings: st({ a: 2 }), unusedLocationIds: [] })
		).toEqual({ kind: 'round', number: 3 });
	});

	it('finishes with a clear winner', () => {
		expect(
			decideNextStep({ regularRoundsPlayed: 3, totalRounds: 3, standings: st({ a: 2, b: 1 }), unusedLocationIds: ['x'] })
		).toEqual({ kind: 'finish', winnerPlayerIds: ['a'] });
	});

	it('goes to sudden death between the tied leaders only', () => {
		expect(
			decideNextStep({
				regularRoundsPlayed: 3,
				totalRounds: 3,
				standings: st({ a: 1, b: 1, c: 1, d: 0 }),
				unusedLocationIds: ['x']
			})
		).toEqual({ kind: 'suddenDeath', eligiblePlayerIds: ['a', 'b', 'c'] });
	});

	it('shares the win when the library has no unused location', () => {
		expect(
			decideNextStep({ regularRoundsPlayed: 3, totalRounds: 3, standings: st({ a: 2, b: 2, c: 0 }), unusedLocationIds: [] })
		).toEqual({ kind: 'finish', winnerPlayerIds: ['a', 'b'] });
	});

	it('nobody wins if no round was won, and no players means no winner', () => {
		expect(
			decideNextStep({ regularRoundsPlayed: 2, totalRounds: 2, standings: st({ a: 0, b: 0 }), unusedLocationIds: ['x'] })
		).toEqual({ kind: 'finish', winnerPlayerIds: [] });
		expect(decideNextStep({ regularRoundsPlayed: 1, totalRounds: 1, standings: [], unusedLocationIds: ['x'] })).toEqual({
			kind: 'finish',
			winnerPlayerIds: []
		});
	});

	it('a single player who won a round wins', () => {
		expect(
			decideNextStep({ regularRoundsPlayed: 1, totalRounds: 1, standings: st({ solo: 1 }), unusedLocationIds: [] })
		).toEqual({ kind: 'finish', winnerPlayerIds: ['solo'] });
	});
});

describe('teams', () => {
	// Team 0: a, b · team 1: c, d · team 2: e (join order a…e).
	const players = [
		{ id: 'a', team: 0 },
		{ id: 'b', team: 0 },
		{ id: 'c', team: 1 },
		{ id: 'd', team: 1 },
		{ id: 'e', team: 2 }
	];
	const rows = (ids: string[]) => ids.map((playerId) => ({ playerId }));

	describe('roundWinnerTeams', () => {
		it('one point per team: two players of one team tying give that team once', () => {
			expect(roundWinnerTeams(['b', 'a'], players)).toEqual([0]);
		});
		it('players of two teams tying give both teams, ascending', () => {
			expect(roundWinnerTeams(['e', 'c'], players)).toEqual([1, 2]);
		});
		it('nobody guessed, or the winner is no longer an active player', () => {
			expect(roundWinnerTeams([], players)).toEqual([]);
			expect(roundWinnerTeams(['kicked'], players)).toEqual([]);
		});
	});

	describe('computeTeamStandings', () => {
		it('ranks by rounds won, then team index; members keep the standings order', () => {
			const t = computeTeamStandings(players, rows(['d', 'a', 'e', 'c', 'b']), [
				{ winnerPlayerIds: ['c'] },
				{ winnerPlayerIds: ['a', 'b'] },
				{ winnerPlayerIds: ['d'] },
				{ winnerPlayerIds: ['e', 'a'] }
			]);
			expect(t.map((r) => [r.team, r.roundsWon, r.rank])).toEqual([
				[0, 2, 1],
				[1, 2, 1],
				[2, 1, 3]
			]);
			expect(t[0]!.members.map((m) => m.playerId)).toEqual(['a', 'b']);
			expect(t[1]!.members.map((m) => m.playerId)).toEqual(['d', 'c']);
		});

		it('leaves out teams without active members and drops kicked members’ wins', () => {
			// 'e' (team 2) was kicked: not in `players`, its round win is gone, so is team 2.
			const active = players.filter((p) => p.id !== 'e');
			const t = computeTeamStandings(active, rows(['a', 'b', 'c', 'd']), [
				{ winnerPlayerIds: ['e'] },
				{ winnerPlayerIds: ['c'] }
			]);
			expect(t.map((r) => [r.team, r.roundsWon, r.rank])).toEqual([
				[1, 1, 1],
				[0, 0, 2]
			]);
		});

		it('with no rounds every team shares first place; nobody wins yet', () => {
			const t = computeTeamStandings(players, rows(['a', 'b', 'c', 'd', 'e']), []);
			expect(t.map((r) => [r.team, r.rank])).toEqual([
				[0, 1],
				[1, 1],
				[2, 1]
			]);
			expect(currentWinnerTeams(t)).toEqual([]);
		});
	});

	describe('decideTeamNextStep', () => {
		const st = (won: Record<number, number>) =>
			Object.entries(won).map(([team, roundsWon]) => ({ team: Number(team), roundsWon }));

		it('plays the next regular round while rounds remain', () => {
			expect(
				decideTeamNextStep({
					regularRoundsPlayed: 1,
					totalRounds: 3,
					teamStandings: st({ 0: 1 }),
					players,
					unusedLocationIds: []
				})
			).toEqual({ kind: 'round', number: 2 });
		});

		it('finishes with a single winning team and its active members', () => {
			expect(
				decideTeamNextStep({
					regularRoundsPlayed: 3,
					totalRounds: 3,
					teamStandings: st({ 1: 2, 0: 1, 2: 0 }),
					players,
					unusedLocationIds: ['x']
				})
			).toEqual({ kind: 'finish', winnerPlayerIds: ['c', 'd'], winnerTeams: [1] });
		});

		it('sudden death with every member of the tied teams, in team then join order', () => {
			expect(
				decideTeamNextStep({
					regularRoundsPlayed: 3,
					totalRounds: 3,
					teamStandings: st({ 2: 1, 0: 1, 1: 0 }),
					players,
					unusedLocationIds: ['x']
				})
			).toEqual({ kind: 'suddenDeath', eligiblePlayerIds: ['a', 'b', 'e'], teams: [0, 2] });
		});

		it('the tied teams share the win when no location is left', () => {
			expect(
				decideTeamNextStep({
					regularRoundsPlayed: 3,
					totalRounds: 3,
					teamStandings: st({ 0: 1, 1: 1, 2: 0 }),
					players,
					unusedLocationIds: []
				})
			).toEqual({ kind: 'finish', winnerPlayerIds: ['a', 'b', 'c', 'd'], winnerTeams: [0, 1] });
		});

		it('nobody wins if no round was won', () => {
			expect(
				decideTeamNextStep({
					regularRoundsPlayed: 2,
					totalRounds: 2,
					teamStandings: st({ 0: 0, 1: 0 }),
					players,
					unusedLocationIds: ['x']
				})
			).toEqual({ kind: 'finish', winnerPlayerIds: [], winnerTeams: [] });
		});
	});
});

describe('pickRoundLocations / pickRandom', () => {
	const ids = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

	it('takes the first N in playlist order', () => {
		expect(pickRoundLocations(ids, 3, 'first', false)).toEqual(['l1', 'l2', 'l3']);
	});

	it('caps the count and drops duplicates', () => {
		expect(pickRoundLocations(['a', 'b', 'a'], 10, 'first', false)).toEqual(['a', 'b']);
		expect(pickRoundLocations([], 3, 'random', true)).toEqual([]);
		expect(pickRoundLocations(ids, 0, 'first', false)).toEqual([]);
	});

	it('random N keeps playlist order unless shuffled', () => {
		const r = pickRoundLocations(ids, 3, 'random', false, rng(1));
		expect(r).toHaveLength(3);
		expect(new Set(r).size).toBe(3);
		expect([...r].sort((a, b) => ids.indexOf(a) - ids.indexOf(b))).toEqual(r);
		// Over many seeds, every location gets picked sometimes.
		const seen = new Set<string>();
		for (let s = 0; s < 50; s++) for (const id of pickRoundLocations(ids, 2, 'random', false, rng(s))) seen.add(id);
		expect(seen.size).toBe(ids.length);
	});

	it('shuffle permutes the chosen set', () => {
		const r = pickRoundLocations(ids, 6, 'first', true, rng(7));
		expect([...r].sort()).toEqual(ids);
		const orders = new Set<string>();
		for (let s = 0; s < 20; s++) orders.add(pickRoundLocations(ids, 6, 'first', true, rng(s)).join());
		expect(orders.size).toBeGreaterThan(1);
	});

	it('shuffled survives an rng returning ~1', () => {
		expect(shuffled([1, 2, 3], () => 0.9999999999).sort()).toEqual([1, 2, 3]);
	});

	it('pickRandom returns an element or null', () => {
		expect(pickRandom([], rng(1))).toBeNull();
		expect(pickRandom(['x'], () => 0.999999)).toBe('x');
		expect(['a', 'b', 'c']).toContain(pickRandom(['a', 'b', 'c'], rng(3)));
	});
});
