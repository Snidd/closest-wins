/**
 * Reveal choreography, driven only by server timestamps so every screen (and a TV that
 * reloads mid-reveal) shows the same stage at the same moment.
 *
 *   revealStartedAt ── pins ──▶ answerVisibleAt ── flying ──▶ +REVEAL_FLY_MS ── lines ──▶ +REVEAL_LINES_MS ── done
 *
 * - `pins`:   all guesses on the world view (suspense; `answerVisibleAt - revealStartedAt` is
 *             the server's REVEAL_SUSPENSE_MS).
 * - `flying`: the target marker drops in and the camera flies to frame it and the closest
 *             guesses. Phones may show the answer from here (`answerVisibleAt`).
 * - `lines`:  great-circle lines grow from each guess to the target, distances appear.
 * - `done`:   winner(s) highlighted; the page shows the location name and fact.
 *
 * `skipped` jumps straight to `done`.
 */
import type { LatLng } from '#lib/geo.ts';
import type { RevealGuess, RoundResult } from '#lib/game/types.ts';
import { greatCirclePath, padBounds, boundsOf, unwrapLng, type Bounds, type LngLatTuple } from './geometry.ts';

export const REVEAL_FLY_MS = 2800;
export const REVEAL_LINES_MS = 1600;

export const REVEAL_STAGES = ['pins', 'flying', 'lines', 'done'] as const;
export type RevealStage = (typeof REVEAL_STAGES)[number];

export interface RevealTiming {
	stage: RevealStage;
	/** 0..1 within the current stage (1 for `done`). */
	progress: number;
	/** Server time the current stage started / ends (`Infinity` for `done`). */
	startsAt: number;
	endsAt: number;
}

type TimingInput = Pick<RoundResult, 'revealStartedAt' | 'answerVisibleAt' | 'skipped'>;

/** Server time at which the reveal reaches `done` (name and fact can be shown). */
export function revealDoneAt(r: TimingInput): number {
	return r.skipped ? r.revealStartedAt : r.answerVisibleAt + REVEAL_FLY_MS + REVEAL_LINES_MS;
}

/** Stage of the reveal at server time `now`. */
export function revealTimingAt(r: TimingInput, now: number): RevealTiming {
	if (r.skipped) return { stage: 'done', progress: 1, startsAt: r.revealStartedAt, endsAt: Infinity };
	const flyAt = r.answerVisibleAt;
	const linesAt = flyAt + REVEAL_FLY_MS;
	const doneAt = linesAt + REVEAL_LINES_MS;
	const frac = (a: number, b: number) => (b > a ? Math.min(1, Math.max(0, (now - a) / (b - a))) : 1);
	if (now < flyAt) {
		return { stage: 'pins', progress: frac(r.revealStartedAt, flyAt), startsAt: r.revealStartedAt, endsAt: flyAt };
	}
	if (now < linesAt) return { stage: 'flying', progress: frac(flyAt, linesAt), startsAt: flyAt, endsAt: linesAt };
	if (now < doneAt) return { stage: 'lines', progress: frac(linesAt, doneAt), startsAt: linesAt, endsAt: doneAt };
	return { stage: 'done', progress: 1, startsAt: doneAt, endsAt: Infinity };
}

/**
 * Guesses the camera frames together with the target: the winners, plus the next closest
 * (rank ≤ 3) as long as they are not much farther away than the winner, so one wild guess
 * does not zoom the answer out to the whole world.
 */
export function framedGuesses(guesses: RevealGuess[]): RevealGuess[] {
	const best = guesses.reduce((m, g) => Math.min(m, g.distanceKm), Infinity);
	const limit = Math.max(best * 3, 600);
	return guesses.filter((g) => g.isWinner || (g.rank <= 3 && g.distanceKm <= limit));
}

/** Great-circle path from a guess to the target, continuous and anchored at the target. */
export function guessPath(guess: LatLng, target: LatLng): LngLatTuple[] {
	const from = { lat: guess.lat, lng: unwrapLng(guess.lng, target.lng) };
	return greatCirclePath(from, target);
}

/** Bounds the camera should frame for the answer (target + framed guesses + their lines). */
export function answerBounds(target: LatLng, guesses: RevealGuess[]): Bounds {
	const pts: LngLatTuple[] = [[target.lng, target.lat]];
	for (const g of framedGuesses(guesses)) pts.push(...guessPath(g, target));
	// Anchor longitudes at the target so the box is compact around it.
	const anchored = pts.map(([lng, lat]) => [unwrapLng(lng, target.lng), lat] as LngLatTuple);
	return padBounds(boundsOf(anchored)!, 1.5);
}

/** Bounds of all guesses (for the suspense view; never depends on the target). */
export function guessesBounds(guesses: LatLng[]): Bounds | null {
	const b = boundsOf(guesses.map((g) => [g.lng, g.lat]));
	return b && padBounds(b, 20);
}
