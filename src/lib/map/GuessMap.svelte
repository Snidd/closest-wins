<!--
  Phone guessing map: full-bleed, one finger pans, two fingers pinch-zoom (no rotation or
  pitch), double tap zooms in. A fixed cross at the exact centre marks the guess.

  ```svelte
  <GuessMap
  	bind:this={guessMap}
  	bind:touched
  	initialCenter={myGuess ? { lat: myGuess.lat, lng: myGuess.lng } : null}
  	locked={!!myGuess?.lockedAt}
  	color={me.color}
  	onchange={(g) => updateGuess({ gameId, roundIndex, lat: g.lat, lng: g.lng, touched: g.touched })}
  />
  // lock in:   const g = guessMap.getGuess(); await lockIn({ ...ids, lat: g.lat, lng: g.lng, touched: g.touched });
  // new round: guessMap.reset();
  ```

  - `onchange` is debounced (GUESS_UPDATE_DEBOUNCE_MS after the last movement, and at least
    every GUESS_UPDATE_MAX_WAIT_MS while the user keeps moving). It only fires for user
    movement, never for `reset()` or the initial view.
  - `getGuess()` returns the current cross position immediately and stops any running pan
    inertia, so the map does not drift away from the returned point.
  - Longitudes are normalised to [-180, 180]; latitudes stay within the Mercator range.
  - Place overlay UI (clue panel, lock-in button) as positioned siblings, or pass them as
    children: they are rendered above the map in a layer that does not block the map.
-->
<script lang="ts" module>
	export interface GuessState {
		lat: number;
		lng: number;
		/** The user panned or zoomed at least once since mount / the last reset(). */
		touched: boolean;
		zoom: number;
	}
</script>

<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack, type Snippet } from 'svelte';
	import { clampLat, normalizeLng } from '#lib/geo.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { map as mapDict } from '#lib/i18n/map.ts';
	import {
		createMap,
		MapInitError,
		onTileError,
		setMapTheme,
		type Corner,
		type MapFailure,
		type MaplibreMap
	} from './base.ts';
	import {
		GUESS_UPDATE_DEBOUNCE_MS,
		GUESS_UPDATE_MAX_WAIT_MS,
		MAX_ZOOM,
		MIN_ZOOM,
		WORLD_VIEW
	} from './config.ts';
	import { worldFitZoom } from './geometry.ts';
	import MapChrome from './MapChrome.svelte';
	import type { MapTheme } from './style.ts';
	import { useMapTheme } from './theme.svelte.ts';

	type Props = {
		/** Restore a previous cross position (e.g. after a reload). Read once on mount. */
		initialCenter?: { lat: number; lng: number } | null;
		/** Zoom for `initialCenter` (default 4). Read once on mount. */
		initialZoom?: number;
		/** Has the user moved the map this round. Bindable; set it to restore after a reload. */
		touched?: boolean;
		/** Freezes the map and shows the chosen point as a pin in `color`. */
		locked?: boolean;
		/** The player's pin colour (locked marker). */
		color?: string;
		theme?: MapTheme | 'auto';
		/** Corner for the small map attribution (keep it clear of your overlay UI). */
		attributionPosition?: Corner;
		/** Debounced centre updates after user movement. */
		onchange?: (guess: GuessState) => void;
		/** Fires once when the first tiles are on screen. */
		onready?: () => void;
		/** Overlay UI rendered above the map (does not block map gestures outside itself). */
		children?: Snippet;
		class?: string;
	};

	let {
		initialCenter = null,
		initialZoom,
		touched = $bindable(false),
		locked = false,
		color = 'var(--color-primary)',
		theme: themeProp = 'auto',
		attributionPosition = 'bottom-left',
		onchange,
		onready,
		children,
		class: className
	}: Props = $props();

	const t = useT(mapDict);
	const theme = useMapTheme(() => themeProp);

	let container: HTMLDivElement;
	let map: MaplibreMap | undefined;
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let failure = $state<MapFailure | null>(null);

	// ------------------------------------------------------------------------------------
	// Public API
	// ------------------------------------------------------------------------------------

	function readCenter(): GuessState {
		if (!map) {
			const [lng, lat] = initialCenter ? [initialCenter.lng, initialCenter.lat] : WORLD_VIEW.center;
			return { lat, lng: normalizeLng(lng), touched, zoom: initialZoom ?? WORLD_VIEW.zoom };
		}
		const c = map.getCenter();
		return { lat: clampLat(c.lat), lng: normalizeLng(c.lng), touched, zoom: map.getZoom() };
	}

	/** Current cross position, immediately (stops pan inertia first). Use at lock-in. */
	export function getGuess(): GuessState {
		map?.stop();
		return readCenter();
	}

	/** Back to the world view for a new round; clears `touched` and any pending update. */
	export function reset(): void {
		cancelPending();
		touched = false;
		if (!map) return;
		map.stop();
		map.jumpTo(worldView());
	}

	// ------------------------------------------------------------------------------------
	// Debounced change reporting
	// ------------------------------------------------------------------------------------

	let timer: ReturnType<typeof setTimeout> | undefined;
	let pendingSince = 0;

	function cancelPending() {
		clearTimeout(timer);
		timer = undefined;
		pendingSince = 0;
	}

	function flush() {
		cancelPending();
		onchange?.(readCenter());
	}

	function schedule() {
		const now = performance.now();
		if (!pendingSince) pendingSince = now;
		clearTimeout(timer);
		const wait = Math.min(GUESS_UPDATE_DEBOUNCE_MS, Math.max(0, pendingSince + GUESS_UPDATE_MAX_WAIT_MS - now));
		timer = setTimeout(flush, wait);
	}

	function worldView() {
		const width = container?.clientWidth ?? 0;
		return {
			center: WORLD_VIEW.center,
			// Fit the whole world width on narrow screens, but never closer than WORLD_VIEW.
			zoom: worldFitZoom(width, MIN_ZOOM, WORLD_VIEW.zoom)
		};
	}

	// ------------------------------------------------------------------------------------
	// Map lifecycle
	// ------------------------------------------------------------------------------------

	$effect(() => {
		let cancelled = false;
		let instance: MaplibreMap | undefined;
		// Mount once: initial props are read untracked so later changes do not rebuild the map.
		const [start, initialTheme] = untrack(() => [
			initialCenter
				? {
						center: [normalizeLng(initialCenter.lng), clampLat(initialCenter.lat)] as [number, number],
						zoom: initialZoom ?? 4
					}
				: worldView(),
			theme()
		] as const);

		mapTheme = initialTheme;
		createMap(container, initialTheme, {
			...start,
			maxZoom: MAX_ZOOM,
			doubleClickZoom: true,
			scrollZoom: { around: 'center' },
			touchZoomRotate: { around: 'center' },
			keyboard: true,
			clickTolerance: 4
		})
			.then((m) => {
				if (cancelled) {
					m.remove();
					return;
				}
				instance = map = m;
				onTileError(m, () => {
					failure = 'tiles';
					status = 'error';
				});
				let userMoving = false;
				m.on('movestart', (e) => {
					if (e.originalEvent) userMoving = true;
				});
				m.on('move', (e) => {
					if (!userMoving && !e.originalEvent) return;
					if (!touched) touched = true;
					schedule();
				});
				m.on('moveend', (e) => {
					if (userMoving || e.originalEvent) schedule();
					userMoving = false;
					// Keep the camera within one world copy so numbers stay small.
					const c = m.getCenter();
					if (c.lng > 180 || c.lng < -180) m.jumpTo({ center: [normalizeLng(c.lng), c.lat] });
				});
				m.once('idle', () => {
					if (status !== 'error') status = 'ready';
					onready?.();
				});
				applyLocked(m, untrack(() => locked));
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				failure = e instanceof MapInitError ? e.kind : 'other';
				status = 'error';
				console.error('[GuessMap]', e);
			});

		return () => {
			cancelled = true;
			cancelPending();
			instance?.remove();
			map = undefined;
		};
	});

	/** Theme the map currently shows (it may change before the map has loaded). */
	let mapTheme: MapTheme | undefined;
	$effect(() => {
		const th = theme();
		if (status === 'ready' && map && th !== mapTheme) {
			setMapTheme(map, th);
			mapTheme = th;
		}
	});

	function applyLocked(m: MaplibreMap, isLocked: boolean) {
		if (isLocked) {
			m.stop();
			cancelPending();
			for (const h of [m.dragPan, m.touchZoomRotate, m.scrollZoom, m.doubleClickZoom, m.keyboard]) h.disable();
		} else {
			m.dragPan.enable();
			m.touchZoomRotate.enable({ around: 'center' });
			m.touchZoomRotate.disableRotation();
			m.scrollZoom.enable({ around: 'center' });
			m.doubleClickZoom.enable();
			m.keyboard.enable();
			m.keyboard.disableRotation();
		}
	}

	$effect(() => {
		const isLocked = locked;
		if (map) applyLocked(map, isLocked);
	});

	// ------------------------------------------------------------------------------------
	// Keep the page itself still (iOS Safari / Android Chrome)
	// ------------------------------------------------------------------------------------

	$effect(() => {
		const el = container;
		const prevent = (e: Event) => e.preventDefault();
		// Rubber-band scrolling and pull-to-refresh start from touchmove on the page.
		el.addEventListener('touchmove', prevent, { passive: false });
		// iOS Safari page pinch-zoom (it ignores user-scalable=no).
		el.addEventListener('gesturestart', prevent);
		el.addEventListener('gesturechange', prevent);
		el.addEventListener('gestureend', prevent);
		return () => {
			el.removeEventListener('touchmove', prevent);
			el.removeEventListener('gesturestart', prevent);
			el.removeEventListener('gesturechange', prevent);
			el.removeEventListener('gestureend', prevent);
		};
	});
</script>

<div
	class={['guess-map', theme(), { locked, ready: status === 'ready' }, className]}
	style:--pin-color={color}
	data-status={status}
>
	<div
		class="canvas"
		bind:this={container}
		role="application"
		aria-label={t().mapLabel}
		aria-roledescription="map"
	></div>

	<div class="cross" role="img" aria-label={locked ? t().lockedHere : t().crosshair}>
		{#if locked}
			<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
				<circle class="pulse" cx="24" cy="24" r="10" />
				<circle class="ring-halo" cx="24" cy="24" r="10" />
				<circle class="ring" cx="24" cy="24" r="10" />
				<circle class="dot-halo" cx="24" cy="24" r="3.2" />
				<circle class="dot" cx="24" cy="24" r="2.2" />
			</svg>
		{:else}
			<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
				<g class="halo">
					<path d="M24 3v14M24 31v14M3 24h14M31 24h14" />
					<circle cx="24" cy="24" r="1.6" />
				</g>
				<g class="arms">
					<path d="M24 3v14M24 31v14M3 24h14M31 24h14" />
					<circle cx="24" cy="24" r="1.6" />
				</g>
			</svg>
		{/if}
	</div>

	<MapChrome {status} {failure} attribution={attributionPosition} />

	{#if children}
		<div class="overlay">{@render children()}</div>
	{/if}
</div>

<style>
	.guess-map {
		--cross-ink: var(--color-cross);
		--cross-halo: var(--color-cross-outline);
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-ocean);
		touch-action: none;
		overscroll-behavior: none;
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}
	.guess-map.dark {
		--cross-ink: #ffffff;
		--cross-halo: #06121f;
	}
	.canvas {
		position: absolute;
		inset: 0;
		touch-action: none;
	}
	.canvas :global(.maplibregl-canvas) {
		outline: none;
		transition: filter var(--duration-slow) var(--ease-out);
	}
	.locked .canvas :global(.maplibregl-canvas) {
		filter: saturate(0.55) brightness(0.97);
	}
	.cross {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 48px;
		height: 48px;
		transform: translate(-50%, -50%);
		pointer-events: none;
		z-index: 2;
		opacity: 0;
		transition: opacity var(--duration-normal);
	}
	.ready .cross,
	.locked .cross {
		opacity: 1;
	}
	.cross svg {
		display: block;
		overflow: visible;
	}
	.halo path,
	.halo circle {
		stroke: var(--cross-halo);
		stroke-width: 4.5;
		stroke-linecap: round;
		fill: var(--cross-halo);
		opacity: 0.9;
	}
	.arms path {
		stroke: var(--cross-ink);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.arms circle {
		fill: var(--cross-ink);
	}
	.ring-halo {
		fill: none;
		stroke: #ffffff;
		stroke-width: 7;
	}
	.ring {
		fill: color-mix(in srgb, var(--pin-color) 25%, transparent);
		stroke: var(--pin-color);
		stroke-width: 4;
	}
	.dot-halo {
		fill: #ffffff;
	}
	.dot {
		fill: #0f1b2a;
	}
	.pulse {
		fill: none;
		stroke: var(--pin-color);
		stroke-width: 3;
		transform-origin: 24px 24px;
		animation: pulse 1.8s var(--ease-out) infinite;
	}
	@keyframes pulse {
		0% {
			transform: scale(1);
			opacity: 0.8;
		}
		100% {
			transform: scale(2.4);
			opacity: 0;
		}
	}
	.overlay {
		position: absolute;
		inset: 0;
		z-index: 5;
		pointer-events: none;
	}
	.overlay > :global(*) {
		pointer-events: auto;
	}
</style>
