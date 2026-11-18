/**
 * Reveal choreography, driven only by server timestamps so every screen (and a TV that
 * reloads mid-reveal) shows the same stage at the same moment.
 *
 *   revealStartedAt ── pins ──▶ answerVisibleAt ── flying ──▶ +REVEAL_FLY_MS ── lines ──▶ +REVEAL_LINES_MS ── done
 *
 * - `pins`:   the guesses appear on the world view one by one, each at its `revealAt`, then a
 *             hold (the server's schedule: `revealSchedule` in `#lib/game/reveal.ts`).
 * - `flying`: the target marker drops in and the camera flies to frame it and the closest
 *             guesses (`answerBounds`, at most `answerMaxZoom`). When two or more guesses are
 *             within `CLOSE_GUESS_KM`, it frames only those and may zoom in to `MAX_ZOOM`.
 *             Phones may show the answer from here (`answerVisibleAt`).
 * - `lines`:  great-circle lines grow from each guess to the target, distances count up.
 * - `done`:   winner(s) highlighted; the page shows the location name and fact.
 *
 * `skipped` jumps straight to `done`.
 */
import type { LatLng } from '#lib/geo.ts';
import type { RevealGuess, RoundResult } from '#lib/game/types.ts';
import { MAX_ZOOM } from './config.ts';
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

/**
 * Server time at which the TV shows the answer (the place name appears when the camera has
 * landed, at the start of `lines`; at once when skipped). Phones must not show the answer or
 * the player's own result before this, or they would spoil the big screen's suspense.
 */
export function answerShownAt(r: TimingInput): number {
	return r.skipped ? r.answerVisibleAt : r.answerVisibleAt + REVEAL_FLY_MS;
}

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

/** A guess this close to the target or closer (km) counts as very close. */
export const CLOSE_GUESS_KM = 100;
/** Zoom cap of the answer camera, so a lone close guess still shows some surroundings. */
export const ANSWER_MAX_ZOOM = 7;
/** Minimum span (degrees) of the answer bounds. */
export const ANSWER_MIN_SPAN_DEG = 1.5;
/** Minimum span (degrees, about 11 km) of the answer bounds in close mode. */
export const CLOSE_MIN_SPAN_DEG = 0.1;

/**
 * The very close guesses (within `CLOSE_GUESS_KM`) when there are at least two of them, else
 * `[]`. A non-empty list is "close mode": the camera frames only these and may zoom in further.
 */
export function closeGuesses(guesses: RevealGuess[]): RevealGuess[] {
	const close = guesses.filter((g) => g.distanceKm <= CLOSE_GUESS_KM);
	return close.length >= 2 ? close : [];
}

/**
 * Guesses the camera frames together with the target: the winners, plus the next closest
 * (rank ≤ 3) as long as they are not much farther away than the winner, so one wild guess
 * does not zoom the answer out to the whole world. In close mode (`closeGuesses`), exactly the
 * close guesses, so labels of guesses a few km apart do not collide.
 * The tvOS port (`tvos/Core/Sources/ClosestWinsCore/RevealGeometry.swift`) has no close mode yet.
 */
export function framedGuesses(guesses: RevealGuess[]): RevealGuess[] {
	const close = closeGuesses(guesses);
	if (close.length) return close;
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
	const minSpan = closeGuesses(guesses).length ? CLOSE_MIN_SPAN_DEG : ANSWER_MIN_SPAN_DEG;
	return padBounds(boundsOf(anchored)!, minSpan);
}

/** Zoom cap of the answer camera: `MAX_ZOOM` in close mode, else `ANSWER_MAX_ZOOM`. */
export function answerMaxZoom(guesses: RevealGuess[]): number {
	return closeGuesses(guesses).length ? MAX_ZOOM : ANSWER_MAX_ZOOM;
}

/** Bounds of all guesses (for the suspense view; never depends on the target). */
export function guessesBounds(guesses: LatLng[]): Bounds | null {
	const b = boundsOf(guesses.map((g) => [g.lng, g.lat]));
	return b && padBounds(b, 20);
}
