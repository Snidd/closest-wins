import { describe, expect, it } from 'vitest';
import type { RevealGuess } from '#lib/game/types.ts';
import { labelBox, placeLabels } from './labels.ts';
import { MAX_ZOOM } from './config.ts';
import {
	ANSWER_MAX_ZOOM,
	answerBounds,
	answerMaxZoom,
	answerShownAt,
	CLOSE_GUESS_KM,
	CLOSE_MIN_SPAN_DEG,
	closeGuesses,
	framedGuesses,
	guessesBounds,
	REVEAL_FLY_MS,
	REVEAL_LINES_MS,
	revealDoneAt,
	revealTimingAt
} from './reveal.ts';

const T0 = 1_000_000;
const timing = { revealStartedAt: T0, answerVisibleAt: T0 + 3000, skipped: false };

describe('revealTimingAt', () => {
	it('walks through the stages on server time', () => {
		expect(revealTimingAt(timing, T0 - 500).stage).toBe('pins'); // clock skew before start
		expect(revealTimingAt(timing, T0 + 1500)).toMatchObject({ stage: 'pins', progress: 0.5 });
		expect(revealTimingAt(timing, T0 + 3000).stage).toBe('flying');
		expect(revealTimingAt(timing, T0 + 3000 + REVEAL_FLY_MS)).toMatchObject({ stage: 'lines', progress: 0 });
		expect(revealTimingAt(timing, T0 + 3000 + REVEAL_FLY_MS + REVEAL_LINES_MS / 2).progress).toBeCloseTo(0.5);
		expect(revealTimingAt(timing, revealDoneAt(timing)).stage).toBe('done');
		expect(revealTimingAt(timing, T0 + 3_600_000)).toMatchObject({ stage: 'done', progress: 1 });
	});
	it('reports when the stage ends (for a reloaded screen resuming a flight)', () => {
		const tm = revealTimingAt(timing, T0 + 4000);
		expect(tm.endsAt - (T0 + 4000)).toBe(REVEAL_FLY_MS - 1000);
	});
	it('phones show the answer exactly when the TV shows the place name', () => {
		const shownOnTv = (now: number) => ['lines', 'done'].includes(revealTimingAt(timing, now).stage);
		expect(shownOnTv(answerShownAt(timing) - 1)).toBe(false);
		expect(shownOnTv(answerShownAt(timing))).toBe(true);
		// Not at answerVisibleAt: the TV is still flying there ("And the answer is…").
		expect(answerShownAt(timing)).toBe(timing.answerVisibleAt + REVEAL_FLY_MS);
		const skipped = { ...timing, skipped: true, answerVisibleAt: T0 + 500 };
		expect(answerShownAt(skipped)).toBe(T0 + 500);
	});
	it('jumps to done when skipped', () => {
		const skipped = { ...timing, skipped: true, answerVisibleAt: T0 };
		expect(revealTimingAt(skipped, T0).stage).toBe('done');
		expect(revealDoneAt(skipped)).toBe(T0);
	});
});

const g = (playerId: string, lat: number, lng: number, distanceKm: number, rank: number): RevealGuess => ({
	playerId,
	lat,
	lng,
	distanceKm,
	rank,
	isWinner: rank === 1,
	locked: true,
	revealAt: T0
});

describe('framing', () => {
	it('frames winners and close runners-up but not wild guesses', () => {
		const guesses = [g('a', 59, 18, 10, 1), g('b', 60, 19, 120, 2), g('c', -30, 150, 15000, 3), g('d', 0, 0, 20000, 4)];
		expect(framedGuesses(guesses).map((x) => x.playerId)).toEqual(['a', 'b']);
	});
	it('keeps answer bounds compact across the antimeridian', () => {
		const target = { lat: -17.7, lng: 178 };
		const [[w], [e]] = answerBounds(target, [g('a', -16, -179, 300, 1)]);
		expect(e - w).toBeLessThan(10);
	});
	it('pads the suspense view and returns null without guesses', () => {
		expect(guessesBounds([])).toBeNull();
		const [[w, s], [e, n]] = guessesBounds([{ lat: 10, lng: 10 }])!;
		expect(e - w).toBe(20);
		expect(n - s).toBe(20);
	});
});

describe('close mode', () => {
	const target = { lat: 59.33, lng: 18.07 };
	const ids = (gs: RevealGuess[]) => gs.map((x) => x.playerId);
	const span = ([[w, s], [e, n]]: ReturnType<typeof answerBounds>) => ({ lng: e - w, lat: n - s });
	const contains = ([[w, s], [e, n]]: ReturnType<typeof answerBounds>, p: { lat: number; lng: number }) =>
		p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;

	it('is off without close guesses', () => {
		const guesses = [g('a', 59, 18, 150, 1), g('b', 60, 19, 300, 2), g('c', -30, 150, 15000, 3)];
		expect(closeGuesses(guesses)).toEqual([]);
		expect(answerMaxZoom(guesses)).toBe(ANSWER_MAX_ZOOM);
		expect(ids(framedGuesses(guesses))).toEqual(['a', 'b']);
	});
	it('is off with exactly one close guess (the runner-up rule still applies)', () => {
		const guesses = [
			g('a', 59.42, 18.07, 10, 1),
			g('b', 60.68, 18.07, 150, 2),
			g('c', 54.0, 18.07, 600, 3),
			g('d', 41.3, 18.07, 2000, 4)
		];
		expect(closeGuesses(guesses)).toEqual([]);
		expect(ids(framedGuesses(guesses))).toEqual(['a', 'b', 'c']);
		expect(answerMaxZoom(guesses)).toBe(ANSWER_MAX_ZOOM);
		const b = span(answerBounds(target, [g('a', 59.42, 18.07, 10, 1), g('d', 41.3, 18.07, 2000, 4)]));
		expect(b.lng).toBeGreaterThanOrEqual(1.5);
		expect(b.lat).toBeGreaterThanOrEqual(1.5);
	});
	it('is on with two or more close guesses', () => {
		const guesses = [g('a', 59.37, 18.07, 5, 1), g('b', 59.33, 18.9, 40, 2), g('c', 59.33, 19.6, 90, 3)];
		expect(ids(closeGuesses(guesses))).toEqual(['a', 'b', 'c']);
		expect(answerMaxZoom(guesses)).toBe(MAX_ZOOM);
	});
	it('frames only the close guesses when mixed with farther ones', () => {
		const far = g('c', 62.03, 18.07, 300, 3);
		const guesses = [g('a', 59.375, 18.07, 5, 1), g('b', 59.33, 18.775, 40, 2), far, g('d', 41.3, 18.07, 2000, 4)];
		expect(ids(framedGuesses(guesses))).toEqual(['a', 'b']);
		const bounds = answerBounds(target, guesses);
		expect(contains(bounds, { lat: 59.375, lng: 18.07 })).toBe(true);
		expect(contains(bounds, { lat: 59.33, lng: 18.775 })).toBe(true);
		expect(contains(bounds, far)).toBe(false);
	});
	it('frames tied winners', () => {
		const guesses = [g('a', 59.6, 18.07, 30, 1), g('b', 59.06, 18.07, 30, 1), g('c', 50, 10, 1100, 3)];
		expect(guesses.filter((x) => x.isWinner)).toHaveLength(2);
		expect(ids(closeGuesses(guesses))).toEqual(['a', 'b']);
		expect(ids(framedGuesses(guesses))).toEqual(['a', 'b']);
	});
	it('counts a guess at exactly CLOSE_GUESS_KM as close, and not one just above', () => {
		const a = g('a', 59.37, 18.07, 5, 1);
		expect(ids(closeGuesses([a, g('b', 60.23, 18.07, CLOSE_GUESS_KM, 2)]))).toEqual(['a', 'b']);
		expect(closeGuesses([a, g('b', 60.23, 18.07, CLOSE_GUESS_KM + 0.01, 2)])).toEqual([]);
	});
	it('keeps close-mode bounds compact across the antimeridian', () => {
		// Near Fiji, close enough to ±180 that guesses on both sides are within 100 km.
		const fiji = { lat: -17.7, lng: 179.7 };
		const guesses = [g('a', -17.7, 179.6, 11, 1), g('b', -17.75, -179.8, 53, 2)];
		expect(answerMaxZoom(guesses)).toBe(MAX_ZOOM);
		const [[w], [e]] = answerBounds(fiji, guesses);
		expect(w).toBeLessThan(e);
		expect(e - w).toBeLessThan(2);
	});
	it('pads close-mode bounds to CLOSE_MIN_SPAN_DEG, not 1.5 degrees', () => {
		const guesses = [g('a', 59.357, 18.07, 3, 1), g('b', 59.33, 18.158, 5, 2)];
		const b = span(answerBounds(target, guesses));
		for (const v of [b.lng, b.lat]) {
			expect(v).toBeGreaterThanOrEqual(CLOSE_MIN_SPAN_DEG - 1e-9);
			expect(v).toBeLessThan(1.5);
		}
	});
});

describe('placeLabels', () => {
	const viewport = { width: 400, height: 300 };
	it('places labels without overlaps and hides what does not fit', () => {
		const items = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, x: 200, y: 150, w: 60, h: 20 }));
		const res = placeLabels(items, { dotRadius: 6, gap: 10, viewport });
		const boxes = items.filter((i) => res.get(i.id)).map((i) => labelBox(i, res.get(i.id)!, 10));
		expect(boxes.length).toBe(4); // n, e, w, s; the diagonals would overlap these wide labels
		for (const a of boxes)
			for (const b of boxes)
				if (a !== b) expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
		expect(res.get('p0')).toBe('n'); // highest priority gets the preferred spot
		expect(res.get('p11')).toBeNull();
	});
	it('keeps labels inside the viewport', () => {
		const res = placeLabels([{ id: 'a', x: 5, y: 5, w: 60, h: 20 }], { dotRadius: 6, gap: 10, viewport });
		expect(res.get('a')).toBe('se');
	});
	it('keeps a still-free previous position (no jumping)', () => {
		const res = placeLabels([{ id: 'a', x: 200, y: 150, w: 60, h: 20, prev: 'sw' }], { dotRadius: 6, gap: 10, viewport });
		expect(res.get('a')).toBe('sw');
	});
	it('forces a label (winner) even when every spot is blocked', () => {
		const block = [{ x0: 0, y0: 0, x1: 400, y1: 300 }];
		const opts = { dotRadius: 6, gap: 10, viewport, obstacles: block };
		expect(placeLabels([{ id: 'a', x: 200, y: 150, w: 60, h: 20 }], opts).get('a')).toBeNull();
		expect(placeLabels([{ id: 'a', x: 200, y: 150, w: 60, h: 20, force: true }], opts).get('a')).toBe('n');
	});
});
