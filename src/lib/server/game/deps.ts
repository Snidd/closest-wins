/**
 * Injectable clock, timers, randomness and library scope for the engine and views. Production
 * uses the defaults; tests swap them with `setEngineDeps` so nothing sleeps for real round
 * lengths and sudden-death picks stay inside the test's own locations.
 */
import { allLocationIds } from './library.ts';

export type TimerHandle = unknown;

export interface EngineDeps {
	/** Epoch ms, server clock. */
	now(): number;
	/** Schedules `fn` after `ms`. The callback may return a promise (tests await it). */
	setTimer(fn: () => void | Promise<void>, ms: number): TimerHandle;
	clearTimer(handle: TimerHandle): void;
	/** [0, 1) */
	random(): number;
	/** Location ids that sudden death may pick from (default: the whole library). */
	libraryLocationIds(): Promise<string[]>;
}

export const defaultDeps: EngineDeps = {
	now: () => Date.now(),
	setTimer: (fn, ms) => {
		const handle = setTimeout(
			() => {
				void Promise.resolve()
					.then(fn)
					.catch((e) => console.error('[engine] timer failed', e));
			},
			Math.max(0, ms)
		);
		handle.unref?.();
		return handle;
	},
	clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	random: () => Math.random(),
	libraryLocationIds: () => allLocationIds()
};

export const deps: EngineDeps = { ...defaultDeps };

/** Overrides some dependencies (tests). Returns a function restoring the previous ones. */
export function setEngineDeps(overrides: Partial<EngineDeps>): () => void {
	const previous = { ...deps };
	Object.assign(deps, overrides);
	return () => Object.assign(deps, previous);
}
