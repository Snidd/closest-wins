import * as v from 'valibot';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
	CreateGameSchema,
	JoinCodeSchema,
	JoinGameSchema,
	LockInSchema,
	NicknameSchema,
	PairTvSchema,
	photoUrl,
	type PlayerSnapshot,
	type RoundState,
	type TvSnapshot
} from './types.ts';

describe('command schemas', () => {
	it('normalises join codes', () => {
		expect(v.parse(JoinCodeSchema, ' abcd ')).toBe('ABCD');
		expect(v.safeParse(JoinCodeSchema, 'ABCI').success).toBe(false); // I is not in the alphabet
		expect(v.safeParse(JoinCodeSchema, 'ABC').success).toBe(false);
	});

	it('validates nicknames', () => {
		expect(v.parse(NicknameSchema, '  Ola  ')).toBe('Ola');
		expect(v.safeParse(NicknameSchema, '').success).toBe(false);
		expect(v.safeParse(NicknameSchema, 'x'.repeat(17)).success).toBe(false);
		expect(v.safeParse(NicknameSchema, 'å'.repeat(16)).success).toBe(true);
		expect(v.safeParse(NicknameSchema, '👩‍👩‍👧‍👦 Ola').success).toBe(true);
		expect(v.safeParse(NicknameSchema, 'evil\u202Etxt').success).toBe(false);
		expect(v.safeParse(NicknameSchema, 'a\u0000b').success).toBe(false);
		expect(v.parse(JoinGameSchema, { code: 'wxyz', nickname: 'Åsa' })).toEqual({ code: 'WXYZ', nickname: 'Åsa' });
	});

	it('validates guesses and game creation', () => {
		const id = '3f0e9f8e-5b8a-4b8e-9f3a-1c2d3e4f5a6b';
		expect(v.safeParse(LockInSchema, { gameId: id, roundIndex: 0, lat: 10, lng: 370, touched: true }).success).toBe(true);
		expect(v.safeParse(LockInSchema, { gameId: id, roundIndex: 0, lat: 91, lng: 0, touched: true }).success).toBe(false);
		const game = v.parse(CreateGameSchema, {
			playlistId: id,
			roundCount: 5,
			selection: 'random',
			timerSeconds: 30,
			language: 'sv'
		});
		expect(game.shuffle).toBe(false);
		expect(v.safeParse(PairTvSchema, { gameId: id, pairingCode: '12345' }).success).toBe(false);
	});

	it('builds photo URLs', () => {
		expect(photoUrl('abc', 'md')).toBe('/media/abc/md.webp');
	});
});

describe('snapshot types', () => {
	it('never carries the answer during a round', () => {
		expectTypeOf<RoundState['result']>().toEqualTypeOf<undefined>();
		type PlayerRound = Extract<PlayerSnapshot, { phase: 'round' }>;
		expectTypeOf<PlayerRound['result']>().toEqualTypeOf<undefined>();
		type TvRound = Extract<TvSnapshot, { phase: 'round' }>;
		expectTypeOf<TvRound['result']>().toEqualTypeOf<undefined>();
		type TvReveal = Extract<TvSnapshot, { phase: 'reveal' }>;
		expectTypeOf<TvReveal['result']['target']['lat']>().toEqualTypeOf<number>();

		// Attaching a result to a round snapshot is a compile error:
		const round = {} as RoundState;
		// @ts-expect-error -- `result` is `never` in the round phase
		const leaked: RoundState = { ...round, result: { target: { lat: 1, lng: 2 } } };
		expect(leaked).toBeDefined();
	});
});
