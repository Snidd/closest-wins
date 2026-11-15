import { describe, expect, it } from 'vitest';
import type { RevealGuess } from '#lib/game/types.ts';
import { labelBox, placeLabels } from './labels.ts';
import {
	answerBounds,
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
	locked: true
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
