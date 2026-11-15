/**
 * Small client helpers for the player screen: server clock, a reactive "now", command error
 * classification and the screen wake lock.
 */
import { createSubscriber } from 'svelte/reactivity';

/**
 * Best estimate of `serverNow - Date.now()`. Every snapshot is a little stale when it arrives
 * (network, or a server-rendered snapshot hydrated seconds later), which only ever makes the
 * measured offset too small, so the largest recent offset wins. A clearly smaller one (>2 s)
 * means the phone's clock really changed, and is taken as is.
 */
export class ServerClock {
	offset = $state(0);
	#seen = false;

	observe(serverNow: number, clientNow = Date.now()): void {
		const o = serverNow - clientNow;
		if (!this.#seen || o > this.offset || o < this.offset - 2000) {
			this.offset = o;
			this.#seen = true;
		}
	}

	/** Server time now (not reactive; combine with `ticker()` in templates). */
	now(): number {
		return Date.now() + this.offset;
	}
}

/**
 * Reactive `Date.now()` that only ticks while something reads it (and immediately when the
 * page becomes visible again, e.g. after the phone slept).
 */
export function ticker(intervalMs: number): () => number {
	const subscribe = createSubscriber((update) => {
		const id = setInterval(update, intervalMs);
		const onVisible = () => {
			if (document.visibilityState === 'visible') update();
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(id);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
	return () => {
		subscribe();
		return Date.now();
	};
}

/** HTTP status of a failed remote call, or `null` for a network/transport failure. */
export function errorStatus(e: unknown): number | null {
	const err = e as { status?: unknown; body?: { status?: unknown } } | null;
	const status = err?.status ?? err?.body?.status;
	return typeof status === 'number' ? status : null;
}

export function errorMessage(e: unknown): string {
	const err = e as { body?: { message?: unknown }; message?: unknown } | null;
	const m = err?.body?.message ?? err?.message;
	return typeof m === 'string' ? m : '';
}

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

/**
 * Keeps the screen on while `active()` is true (best effort: the Wake Lock API is missing on
 * older browsers, and the browser drops the lock whenever the page is hidden, so it is
 * re-acquired when the page becomes visible again). Call during component initialisation.
 */
export function useWakeLock(active: () => boolean): void {
	$effect(() => {
		if (!active()) return;
		const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
		if (!wl) return;
		let sentinel: WakeLockSentinelLike | null = null;
		let stopped = false;
		const acquire = async () => {
			if (stopped || sentinel || document.visibilityState !== 'visible') return;
			try {
				const s = await wl.request('screen');
				if (stopped) {
					void s.release().catch(() => {});
					return;
				}
				sentinel = s;
				s.addEventListener('release', () => {
					if (sentinel === s) sentinel = null;
				});
			} catch {
				// Denied (battery saver, iframe, no user gesture yet): nothing to do.
			}
		};
		const onVisible = () => void acquire();
		document.addEventListener('visibilitychange', onVisible);
		void acquire();
		return () => {
			stopped = true;
			document.removeEventListener('visibilitychange', onVisible);
			void sentinel?.release().catch(() => {});
			sentinel = null;
		};
	});
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
