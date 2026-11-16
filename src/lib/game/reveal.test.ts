import { describe, expect, it } from 'vitest';
import { REVEAL_HOLD_MS, REVEAL_PINS_MAX_MS, REVEAL_PIN_STEP_MS, revealSchedule } from './reveal.ts';

const T0 = 1_000_000;
const ids = (n: number) => Array.from({ length: n }, (_, i) => `player-${i}`);

describe('revealSchedule', () => {
	it('shows one pin per step, then holds before the answer', () => {
		const s = revealSchedule(T0, ids(3), 'round-a');
		expect([...s.revealAt].sort((a, b) => a - b)).toEqual([T0 + 500, T0 + 1000, T0 + 1500]);
		expect(s.answerVisibleAt).toBe(T0 + 3 * REVEAL_PIN_STEP_MS + REVEAL_HOLD_MS);
	});

	it('only holds when nobody guessed', () => {
		expect(revealSchedule(T0, [], 'round-a')).toEqual({ revealAt: [], answerVisibleAt: T0 + REVEAL_HOLD_MS });
	});

	it('speeds the pins up so that many players still finish in time', () => {
		const s = revealSchedule(T0, ids(40), 'round-a');
		expect(Math.max(...s.revealAt)).toBe(T0 + REVEAL_PINS_MAX_MS);
		expect(s.answerVisibleAt).toBe(T0 + REVEAL_PINS_MAX_MS + REVEAL_HOLD_MS);
		expect(new Set(s.revealAt).size).toBe(40);
		expect(Math.min(...s.revealAt)).toBe(T0 + 150);
	});

	it('gives the same order every time for a round', () => {
		expect(revealSchedule(T0, ids(8), 'round-a')).toEqual(revealSchedule(T0, ids(8), 'round-a'));
		// The order of the keys passed in does not matter, only who they are.
		const forward = revealSchedule(T0, ids(8), 'round-a');
		const backward = revealSchedule(T0, ids(8).reverse(), 'round-a');
		expect(backward.revealAt).toEqual([...forward.revealAt].reverse());
	});

	it('mixes the order differently from round to round, and not by input order', () => {
		const a = revealSchedule(T0, ids(8), 'round-a').revealAt;
		const b = revealSchedule(T0, ids(8), 'round-b').revealAt;
		expect(a).not.toEqual(b);
		expect(a).not.toEqual([...a].sort((x, y) => x - y));
	});
});
