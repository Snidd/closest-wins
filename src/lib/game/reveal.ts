/**
 * When the big screen shows each guess of a reveal, and when the answer follows (pure, shared:
 * the server stamps the times into `RoundResult`, clients only read them).
 *
 *   revealStartedAt ─ pin, pin, pin … (one per step, mixed order) ─ hold ─▶ answerVisibleAt
 *
 * The pins stage grows with the number of guesses up to `REVEAL_PINS_MAX_MS`; beyond that the
 * pins just come faster, so a full game of 40 does not wait 20 seconds.
 */

/** Time between two pins, while the stage has room for it. */
export const REVEAL_PIN_STEP_MS = 500;
/** Longest the pins take to appear, however many there are. */
export const REVEAL_PINS_MAX_MS = 6000;
/** Suspense between the last pin and the answer. */
export const REVEAL_HOLD_MS = 1500;

export interface RevealSchedule {
	/** Server time each guess appears, in the order of the `keys` passed in. */
	revealAt: number[];
	/** Server time the answer may be shown (the big screen starts flying to it). */
	answerVisibleAt: number;
}

/** 32-bit FNV-1a of a string. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/**
 * The schedule for the guesses identified by `keys` (player ids). The order is mixed by `seed`
 * (the round's id): the same every time it is computed, different from round to round, and
 * unrelated to who is closest.
 */
export function revealSchedule(revealStartedAt: number, keys: readonly string[], seed: string): RevealSchedule {
	const n = keys.length;
	const step = n === 0 ? 0 : Math.min(REVEAL_PIN_STEP_MS, REVEAL_PINS_MAX_MS / n);
	const order = keys
		.map((key, index) => ({ key, index, h: hash(`${seed}:${key}`) }))
		.sort((a, b) => a.h - b.h || (a.key < b.key ? -1 : 1));
	const revealAt = new Array<number>(n);
	order.forEach((o, position) => {
		revealAt[o.index] = Math.round(revealStartedAt + (position + 1) * step);
	});
	return { revealAt, answerVisibleAt: Math.round(revealStartedAt + n * step) + REVEAL_HOLD_MS };
}
