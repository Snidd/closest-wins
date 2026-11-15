/**
 * Big-screen helpers: a ticking server clock, the screen wake lock, live-stream recovery and
 * derived standings data.
 */
import type { RoundResult, StandingRow } from '#lib/game/types.ts';

/**
 * Reactive "now" on the server clock (`Date.now() + offset`), re-evaluated every `everyMs`.
 * Call during component init; ticks only while the component is mounted.
 */
export function serverClock(offset: () => number, everyMs = 250) {
	let tick = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (tick = Date.now()), everyMs);
		return () => clearInterval(id);
	});
	return {
		get now() {
			void tick; // reactive dependency; the value itself is always fresh
			return Date.now() + offset();
		}
	};
}

/** Keeps the screen on while the page is visible (Screen Wake Lock API, if available). */
export function useWakeLock() {
	$effect(() => {
		type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };
		const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock;
		if (!wl) return;
		let sentinel: Sentinel | null = null;
		let disposed = false;
		const acquire = async () => {
			if (disposed || sentinel || document.visibilityState !== 'visible') return;
			try {
				sentinel = await wl.request('screen');
				sentinel.addEventListener('release', () => (sentinel = null));
				if (disposed) void sentinel.release();
			} catch {
				// Not allowed (no user activation, battery saver…): the TV just may dim.
			}
		};
		const onVisible = () => void acquire();
		document.addEventListener('visibilitychange', onVisible);
		// Some browsers only grant it after a user gesture; retry on any interaction.
		window.addEventListener('pointerdown', onVisible);
		window.addEventListener('keydown', onVisible);
		void acquire();
		return () => {
			disposed = true;
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener('pointerdown', onVisible);
			window.removeEventListener('keydown', onVisible);
			void sentinel?.release().catch(() => {});
		};
	});
}

export interface Movement {
	/** Positive: moved up this many places since before the round. */
	delta: number;
	/** Won the round just revealed. */
	wonRound: boolean;
}

/**
 * Rank movement caused by the round in `result`: the standings before it are the current ones
 * minus this round's win and distance, ranked the same way (rounds won, shared ranks).
 */
export function movementFor(standings: StandingRow[], result: RoundResult): Map<string, Movement> {
	const winners = new Set(result.winnerPlayerIds);
	const before = standings.map((s) => ({ id: s.playerId, won: s.roundsWon - (winners.has(s.playerId) ? 1 : 0) }));
	const prevRank = new Map<string, number>();
	for (const b of before) prevRank.set(b.id, 1 + before.filter((o) => o.won > b.won).length);
	const out = new Map<string, Movement>();
	for (const s of standings) {
		out.set(s.playerId, { delta: (prevRank.get(s.playerId) ?? s.rank) - s.rank, wonRound: winners.has(s.playerId) });
	}
	return out;
}

/** First grapheme of a nickname, upper-cased (emoji-safe). */
export function initial(nickname: string): string {
	const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
	const first = seg.segment(nickname.trim()).containing(0)?.segment ?? '?';
	return first.toLocaleUpperCase();
}

/** Display host for "go to …" lines: `https://x.y/join/ABCD` → `x.y/join`. */
export function shortJoinUrl(joinUrl: string): string {
	try {
		const u = new URL(joinUrl);
		return `${u.host}${u.pathname.replace(/\/[^/]*$/, '')}`;
	} catch {
		return joinUrl;
	}
}
