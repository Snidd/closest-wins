/**
 * Map layer: labels-free world basemap (self-hosted PMTiles) and the three map components.
 *
 * - `GuessMap`       phone guessing map with a fixed centre cross.
 * - `RevealMap`      TV reveal choreography (pins → flying → lines → done) or its end state.
 * - `StaticPointMap` small preview with one marker and optional click-to-pick (admin).
 */
export { default as GuessMap, type GuessState } from './GuessMap.svelte';
export { default as RevealMap } from './RevealMap.svelte';
export { default as StaticPointMap } from './StaticPointMap.svelte';
export { createMapStyle, registerPmtilesProtocol, type MapTheme } from './style.ts';
export {
	REVEAL_FLY_MS,
	REVEAL_LINES_MS,
	REVEAL_STAGES,
	revealDoneAt,
	revealTimingAt,
	type RevealStage,
	type RevealTiming
} from './reveal.ts';
export * from './config.ts';
