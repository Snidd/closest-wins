<!--
  Reveal map (TV, also usable smaller on a phone). Runs the reveal choreography from server
  timestamps (see `reveal.ts`): pins → flying → lines → done. A screen that (re)mounts
  mid-reveal lands in the right stage; `result.skipped` jumps to the end. New snapshots of the
  same reveal (new `result` object, new `offsetMs`) never restart it.

  ```svelte
  <RevealMap
  	players={snapshot.players}
  	result={snapshot.result}
  	offsetMs={clockOffset(snapshot.serverNow)}
  	padding={{ top: 0, right: 0, bottom: 160, left: 0 }}
  	onstage={(s) => (stage = s)}
  />
  {#if stage === 'done'} name + fact {/if}

  // standings / history: static end state
  <RevealMap players={...} result={...} mode="final" />
  ```
-->
<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { tick, untrack } from 'svelte';
	import type { PlayerSummary, RevealGuess, RoundResult } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { map as mapDict } from '#lib/i18n/map.ts';
	import {
		createMap,
		MapInitError,
		OVERLAY_PREFIX,
		onTileError,
		setMapTheme,
		type Corner,
		type MapFailure,
		type MaplibreMap
	} from './base.ts';
	import { MIN_ZOOM, WORLD_VIEW } from './config.ts';
	import { slicePath, unwrapLng, worldFitZoom, type Bounds, type LngLatTuple } from './geometry.ts';
	import { placeLabels, type Box, type LabelPosition } from './labels.ts';
	import MapChrome from './MapChrome.svelte';
	import {
		answerBounds,
		answerMaxZoom,
		guessesBounds,
		guessPath,
		revealTimingAt,
		type RevealStage,
		type RevealTiming
	} from './reveal.ts';
	import type { MapTheme } from './style.ts';
	import { useMapTheme } from './theme.svelte.ts';

	type Padding = { top: number; right: number; bottom: number; left: number };

	type Props = {
		players: PlayerSummary[];
		result: RoundResult;
		/** `serverNow - Date.now()` (see `clockOffset`); aligns the choreography with the server. */
		offsetMs?: number;
		/** `live` runs the choreography; `final` shows the end state at once (standings, history). */
		mode?: 'live' | 'final';
		/** Emphasise one player's pin (e.g. the phone owner's). */
		highlightPlayerId?: string | null;
		/** Allow panning/zooming (phones). The TV leaves this off. Read once on mount. */
		interactive?: boolean;
		/** Screen area (px) covered by your overlay UI; the camera and labels avoid it. */
		padding?: Partial<Padding>;
		theme?: MapTheme | 'auto';
		attributionPosition?: Corner;
		/** Fires on every stage change (also the first one after mount). */
		onstage?: (stage: RevealStage) => void;
		/** How many guesses are on the map so far (they appear one by one in the `pins` stage). */
		pinsShown?: number;
		class?: string;
	};

	let {
		players,
		result,
		offsetMs = 0,
		mode = 'live',
		highlightPlayerId = null,
		interactive = false,
		padding: paddingProp = {},
		theme: themeProp = 'auto',
		attributionPosition = 'bottom-right',
		onstage,
		pinsShown = $bindable(0),
		class: className
	}: Props = $props();

	const t = useT(mapDict);
	const theme = useMapTheme(() => themeProp);

	const LINES_SOURCE = `${OVERLAY_PREFIX}reveal-lines`;
	const PINS_MAX_ZOOM = 4;

	let container: HTMLDivElement;
	let root: HTMLDivElement;
	let map: MaplibreMap | undefined = $state.raw();
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let failure = $state<MapFailure | null>(null);
	let stage = $state<RevealStage | null>(null);

	/** Exposed for the page: the current stage (null before the map is ready). */
	export function getStage(): RevealStage | null {
		return stage;
	}

	const pad = $derived<Padding>({ top: 0, right: 0, bottom: 0, left: 0, ...paddingProp });

	interface Pin extends RevealGuess {
		nickname: string;
		color: string;
		path: LngLatTuple[];
		order: number;
	}

	const pins = $derived.by<Pin[]>(() => {
		const byId = new Map(players.map((p, i) => [p.id, { p, i }]));
		return result.guesses.map((g) => {
			const entry = byId.get(g.playerId);
			return {
				...g,
				nickname: entry?.p.nickname ?? '?',
				color: entry?.p.color ?? '#888888',
				order: entry?.i ?? 999,
				path: guessPath(g, result.target)
			};
		});
	});

	// ------------------------------------------------------------------------------------
	// Screen positions of pins and target (HTML overlay, re-projected on every map move)
	// ------------------------------------------------------------------------------------

	let positions = $state.raw<Record<string, { x: number; y: number }>>({});
	let targetPos = $state.raw<{ x: number; y: number } | null>(null);
	let labelPos = $state.raw<Map<string, LabelPosition | null>>(new Map());
	let labelSizes: Record<string, { w: number; h: number }> = {};
	let remPx = 16;

	const showDistances = $derived(stage === 'lines' || stage === 'done');
	/**
	 * Server time up to which guesses are on the map: each appears at its `revealAt` during the
	 * `pins` stage. `Infinity` outside that stage (all shown).
	 */
	let pinsUntil = $state(Infinity);
	/** Eased share (0..1) of each line drawn so far; the distances count up with it. */
	let linesDrawn = $state(1);
	$effect.pre(() => {
		pinsShown = pins.filter((p) => p.revealAt <= pinsUntil).length;
	});
	const showTarget = $derived(stage === 'flying' || stage === 'lines' || stage === 'done');

	function project(lng: number, lat: number, centerLng: number) {
		const p = map!.project([unwrapLng(lng, centerLng), lat]);
		return { x: p.x, y: p.y };
	}

	function measureLabels() {
		const sizes: Record<string, { w: number; h: number }> = {};
		for (const el of root.querySelectorAll<HTMLElement>('[data-label-for]')) {
			sizes[el.dataset.labelFor!] = { w: el.offsetWidth, h: el.offsetHeight };
		}
		labelSizes = sizes;
	}

	function labelPriority(a: Pin, b: Pin): number {
		const hl = (p: Pin) => (p.playerId === highlightPlayerId ? 0 : 1);
		if (showDistances) {
			const w = (p: Pin) => (p.isWinner ? 0 : 1);
			return w(a) - w(b) || hl(a) - hl(b) || a.rank - b.rank || a.order - b.order;
		}
		return hl(a) - hl(b) || a.order - b.order;
	}

	/**
	 * Map `move` fires many times per frame during camera animations, and placing ~40 labels is
	 * not free (software rendering on a TV stick): coalesce to one update per animation frame.
	 */
	let frame = 0;
	function schedulePositions() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			updatePositions();
		});
	}

	function updatePositions() {
		if (frame) {
			cancelAnimationFrame(frame);
			frame = 0;
		}
		if (!map) return;
		const centerLng = map.getCenter().lng;
		const next: Record<string, { x: number; y: number }> = {};
		for (const pin of pins) next[pin.playerId] = project(pin.lng, pin.lat, centerLng);
		positions = next;
		const target = project(result.target.lng, result.target.lat, centerLng);
		targetPos = target;

		const width = container.clientWidth;
		const height = container.clientHeight;
		const dotR = remPx * 0.55;
		const obstacles: Box[] = [];
		if (showTarget) {
			// The target's centre; its outer ring may be covered by labels next to a close guess.
			const r = remPx * 0.6;
			obstacles.push({ x0: target.x - r, y0: target.y - r, x1: target.x + r, y1: target.y + r });
		}
		const sorted = [...pins].sort(labelPriority);
		const prev = labelPos;
		labelPos = placeLabels(
			sorted.map((p) => ({
				id: p.playerId,
				x: next[p.playerId]!.x - pad.left,
				y: next[p.playerId]!.y - pad.top,
				w: labelSizes[p.playerId]?.w ?? 80,
				h: labelSizes[p.playerId]?.h ?? 24,
				prev: prev.get(p.playerId) ?? null,
				force: showDistances && p.isWinner
			})),
			{
				dotRadius: dotR,
				gap: dotR + remPx * 0.2,
				viewport: { width: width - pad.left - pad.right, height: height - pad.top - pad.bottom },
				obstacles: obstacles.map((b) => ({
					x0: b.x0 - pad.left,
					x1: b.x1 - pad.left,
					y0: b.y0 - pad.top,
					y1: b.y1 - pad.top
				}))
			}
		);
	}

	// ------------------------------------------------------------------------------------
	// Camera
	// ------------------------------------------------------------------------------------

	function cameraFor(bounds: Bounds | null, maxZoom: number) {
		const m = map!;
		const worldZoom = worldFitZoom(container.clientWidth, MIN_ZOOM, WORLD_VIEW.zoom + 1);
		if (!bounds) return { center: WORLD_VIEW.center as LngLatTuple, zoom: worldZoom };
		// Room for labels around the framed points, on top of the overlay padding.
		const margin = Math.min(container.clientWidth, container.clientHeight) * 0.12 + remPx * 2;
		const cam = m.cameraForBounds(bounds, {
			padding: {
				top: pad.top + margin,
				right: pad.right + margin,
				bottom: pad.bottom + margin,
				left: pad.left + margin
			},
			maxZoom
		});
		if (!cam || cam.zoom === undefined || !Number.isFinite(cam.zoom)) {
			return { center: WORLD_VIEW.center as LngLatTuple, zoom: worldZoom };
		}
		return { center: cam.center!, zoom: Math.max(MIN_ZOOM, cam.zoom) };
	}

	const pinsCamera = () =>
		cameraFor(
			guessesBounds(result.guesses),
			PINS_MAX_ZOOM
		);
	const answerCamera = () => cameraFor(answerBounds(result.target, result.guesses), answerMaxZoom(result.guesses));

	// ------------------------------------------------------------------------------------
	// Lines
	// ------------------------------------------------------------------------------------

	const easeOut = (x: number) => 1 - (1 - x) ** 3;

	function setLines(progress: number) {
		const f = easeOut(Math.max(0, Math.min(1, progress)));
		linesDrawn = f;
		const src = map?.getSource(LINES_SOURCE) as { setData?: (d: unknown) => void } | undefined;
		if (!src?.setData) return;
		src.setData({
			type: 'FeatureCollection',
			features:
				progress <= 0
					? []
					: pins.map((p) => ({
							type: 'Feature',
							properties: { color: p.color, winner: p.isWinner, me: p.playerId === highlightPlayerId },
							geometry: { type: 'LineString', coordinates: slicePath(p.path, f) }
						}))
		});
	}

	function addOverlayLayers(m: MaplibreMap) {
		if (m.getSource(LINES_SOURCE)) return;
		const s = remPx / 16;
		m.addSource(LINES_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
		m.addLayer({
			id: `${LINES_SOURCE}-casing`,
			type: 'line',
			source: LINES_SOURCE,
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': theme() === 'dark' ? '#06121f' : '#ffffff',
				'line-opacity': ['case', ['get', 'winner'], 0.9, 0.55],
				'line-width': ['case', ['get', 'winner'], 7 * s, 4.5 * s]
			}
		});
		m.addLayer({
			id: LINES_SOURCE,
			type: 'line',
			source: LINES_SOURCE,
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['case', ['get', 'winner'], 4 * s, 2.5 * s],
				'line-opacity': ['case', ['any', ['get', 'winner'], ['get', 'me']], 1, 0.8]
			}
		});
	}

	// ------------------------------------------------------------------------------------
	// Choreography
	// ------------------------------------------------------------------------------------

	function enterStage(tm: RevealTiming, from: RevealStage | null, now: number) {
		const m = map!;
		const remaining = tm.endsAt - now;
		switch (tm.stage) {
			case 'pins':
				m.stop();
				m.jumpTo(pinsCamera());
				setLines(0);
				break;
			case 'flying': {
				setLines(0);
				const cam = answerCamera();
				if (from === null) m.jumpTo(pinsCamera());
				if (remaining > 600) {
					m.flyTo({ ...cam, duration: remaining - 150, curve: 1.6, essential: true });
				} else m.jumpTo(cam);
				break;
			}
			case 'lines':
				if (from !== 'flying' || !m.isMoving()) {
					m.stop();
					m.jumpTo(answerCamera());
				}
				setLines(tm.progress);
				break;
			case 'done':
				if (!(from === 'lines' || (from === 'flying' && m.isMoving()))) {
					m.stop();
					m.jumpTo(answerCamera());
				}
				setLines(1);
				break;
		}
	}

	/*
	 * Every snapshot brings a new `result` object and a slightly different `offsetMs`, even while
	 * the same reveal is running (a player connects, a TV reconnects…). Neither may restart the
	 * choreography, or the camera would snap back mid-flight. The run is keyed on the reveal's
	 * identity (round, start, mode); timing changes (`answerVisibleAt`, `skipped`) continue the
	 * run from the stage it is in (a skip jumps to the end). The clock offset is read untracked,
	 * always the latest, so the stage timing follows it without restarting anything.
	 */
	const revealKey = $derived(`${result.round.index}:${result.revealStartedAt}:${mode}`);
	const timingKey = $derived(`${result.answerVisibleAt}:${result.skipped}`);
	let latestOffset = untrack(() => offsetMs);
	$effect.pre(() => {
		latestOffset = offsetMs;
	});
	/** Stage the camera is in, for the run `currentRun` on map `currentMap`. */
	let current: RevealStage | null = null;
	let currentRun = '';
	let currentMap: MaplibreMap | undefined;
	/** Number of stage entries (tests: a new snapshot of the same reveal must not add any). */
	let stageEntries = $state(0);

	$effect(() => {
		if (status !== 'ready' || !map) return;
		const run = revealKey;
		void timingKey;
		if (run !== currentRun || map !== currentMap) {
			currentRun = run;
			currentMap = map;
			current = null;
		}
		const final = mode === 'final';
		let raf = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const step = () => {
			const now = Date.now() + latestOffset;
			const tm: RevealTiming = final
				? { stage: 'done', progress: 1, startsAt: now, endsAt: Infinity }
				: revealTimingAt(untrack(() => result), now);
			if (tm.stage !== current) {
				untrack(() => enterStage(tm, current, now));
				current = tm.stage;
				stage = tm.stage;
				untrack(() => stageEntries++);
				untrack(() => onstage?.(tm.stage));
				// Label content (distances) changes with the stage: re-measure after render.
				void tick().then(() => {
					measureLabels();
					updatePositions();
				});
			} else if (tm.stage === 'lines') {
				untrack(() => setLines(tm.progress));
			}
			pinsUntil = tm.stage === 'pins' ? now : Infinity;
			if (tm.stage === 'lines') raf = requestAnimationFrame(step);
			else if (tm.stage !== 'done') {
				// Wake for the stage boundary, and in `pins` for the next guess to appear.
				let wakeAt = tm.endsAt;
				if (tm.stage === 'pins') {
					for (const g of untrack(() => result.guesses)) {
						if (g.revealAt > now && g.revealAt < wakeAt) wakeAt = g.revealAt;
					}
				}
				timer = setTimeout(step, Math.min(250, Math.max(16, wakeAt - now)));
			}
		};
		step();
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(timer);
		};
	});

	// Re-place labels when inputs that affect them change.
	$effect(() => {
		void pins;
		void highlightPlayerId;
		void pad;
		if (status !== 'ready') return;
		// Guesses changed after the lines were drawn (a player was removed): redraw them.
		if (untrack(() => stage) === 'done') untrack(() => setLines(1));
		void tick().then(() => {
			measureLabels();
			updatePositions();
		});
	});

	// ------------------------------------------------------------------------------------
	// Map lifecycle
	// ------------------------------------------------------------------------------------

	$effect(() => {
		let cancelled = false;
		let instance: MaplibreMap | undefined;
		remPx = parseFloat(getComputedStyle(root).fontSize) || 16;
		const [initialTheme, isInteractive] = untrack(() => [theme(), interactive] as const);
		mapTheme = initialTheme;

		createMap(container, initialTheme, {
			center: WORLD_VIEW.center,
			zoom: worldFitZoom(container.clientWidth, MIN_ZOOM, WORLD_VIEW.zoom + 1),
			interactive: isInteractive,
			keyboard: false,
			doubleClickZoom: isInteractive,
			scrollZoom: isInteractive,
			dragPan: isInteractive,
			touchZoomRotate: isInteractive
		})
			.then((m) => {
				if (cancelled) {
					m.remove();
					return;
				}
				instance = m;
				onTileError(m, () => {
					failure = 'tiles';
					status = 'error';
				});
				m.on('move', schedulePositions);
				let refit: ReturnType<typeof setTimeout> | undefined;
				m.on('resize', () => {
					schedulePositions();
					// Keep the answer framed when the screen changes size (TV / rotation).
					clearTimeout(refit);
					refit = setTimeout(() => {
						if (!isInteractive && (stage === 'done' || stage === 'lines')) m.jumpTo(answerCamera());
						else if (!isInteractive && stage === 'pins') m.jumpTo(pinsCamera());
					}, 150);
				});
				m.once('load', () => {
					if (cancelled) return;
					addOverlayLayers(m);
					map = m;
					if (status !== 'error') status = 'ready';
				});
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				failure = e instanceof MapInitError ? e.kind : 'other';
				status = 'error';
				console.error('[RevealMap]', e);
			});

		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
			frame = 0;
			instance?.remove();
			map = undefined;
		};
	});

	/** Theme the map currently shows (it may change before the map has loaded). */
	let mapTheme: MapTheme | undefined;
	$effect(() => {
		const th = theme();
		const m = map;
		if (m && th !== mapTheme) {
			mapTheme = th;
			setMapTheme(m, th);
			m.once('styledata', () => {
				if (m.getLayer(`${LINES_SOURCE}-casing`)) {
					m.setPaintProperty(`${LINES_SOURCE}-casing`, 'line-color', th === 'dark' ? '#06121f' : '#ffffff');
				}
			});
		}
	});
</script>

<div
	class={['reveal-map', theme(), `stage-${stage ?? 'loading'}`, className]}
	bind:this={root}
	data-status={status}
	data-stage={stage}
	data-stage-entries={stageEntries}
>
	<div class="canvas" bind:this={container} role="img" aria-label={t().revealLabel}></div>

	{#if status === 'ready'}
		<div class="overlay" aria-hidden="true">
			{#if showTarget && targetPos}
				<div class="target" style:transform="translate({targetPos.x}px, {targetPos.y}px)">
					<svg viewBox="-24 -24 48 48" class="target-icon">
						<circle class="t-pulse" r="12" />
						<circle class="t-outer" r="12" />
						<circle class="t-mid" r="7.5" />
						<circle class="t-inner" r="3.5" />
					</svg>
				</div>
			{/if}
			{#each pins as pin (pin.playerId)}
				{@const pos = positions[pin.playerId]}
				{@const lp = labelPos.get(pin.playerId)}
				{#if pos}
					<div
						class={[
							'pin',
							{
								pending: pin.revealAt > pinsUntil,
								winner: showDistances && pin.isWinner,
								me: pin.playerId === highlightPlayerId,
								dim: stage === 'done' && !pin.isWinner
							}
						]}
						style:transform="translate({pos.x}px, {pos.y}px)"
						style:--pin={pin.color}
						style:z-index={showDistances ? 100 - pin.rank : undefined}
					>
						<span class="body">
						<span class="dot"></span>
						<span
							class={['label', lp ? `pos-${lp}` : 'hidden']}
							data-label-for={pin.playerId}
						>
							{#if showDistances && pin.isWinner}
								<svg class="crown" viewBox="0 0 24 18" aria-label={t().winner}>
									<path d="M2 16h20l1-11-6 4-5-8-5 8-6-4z" />
								</svg>
							{/if}
							<span class="name">{pin.nickname}</span>
							{#if stage === 'lines'}
								<!-- Counts up with the line; the hidden final text keeps the label's size. -->
								<span class="dist counting">
									<span class="final">{t().km(pin.distanceKm)}</span>
									<span class="now">{t().km(pin.distanceKm * linesDrawn)}</span>
								</span>
							{:else if showDistances}
								<span class="dist">{t().km(pin.distanceKm)}</span>
							{/if}
						</span>
						</span>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<MapChrome {status} {failure} attribution={attributionPosition} />
</div>

<style>
	.reveal-map {
		--pin-outline: #ffffff;
		--pin-ink: #0f1b2a;
		--label-bg: rgb(255 255 255 / 0.94);
		--label-fg: #0f1b2a;
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: var(--color-ocean);
		-webkit-user-select: none;
		user-select: none;
	}
	.reveal-map.dark {
		--pin-outline: #ffffff;
		--label-bg: rgb(12 24 38 / 0.92);
		--label-fg: #e8eef6;
	}
	.canvas {
		position: absolute;
		inset: 0;
	}
	.canvas :global(.maplibregl-canvas) {
		outline: none;
	}
	.overlay {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		contain: strict;
	}

	/* Pins: the element sits exactly on the point; dot and label are positioned around it. */
	.pin {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
		transition: opacity var(--duration-slow);
	}
	.body {
		position: absolute;
		left: 0;
		top: 0;
	}
	/* Not on the map yet (its turn comes during the `pins` stage); it pops in when it is. */
	.pin.pending {
		visibility: hidden;
	}
	.pin:not(.pending) .body {
		animation: pin-in 420ms var(--ease-out) both;
	}
	.dot {
		position: absolute;
		left: -0.55rem;
		top: -0.55rem;
		width: 1.1rem;
		height: 1.1rem;
		border-radius: 50%;
		background: var(--pin);
		border: 0.17rem solid var(--pin-outline);
		box-shadow:
			0 0 0 1px rgb(15 27 42 / 0.55),
			0 2px 6px rgb(0 0 0 / 0.35);
		transition: transform var(--duration-slow) var(--ease-out);
	}
	.label {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 0.3em;
		padding: 0.12em 0.5em 0.12em 0.4em;
		border-radius: var(--radius-pill);
		background: var(--label-bg);
		color: var(--label-fg);
		border-left: 0.3em solid var(--pin);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.3);
		font-size: 0.8rem;
		font-weight: var(--weight-bold);
		line-height: 1.25;
		white-space: nowrap;
		transition: opacity var(--duration-normal);
	}
	.label.hidden {
		visibility: hidden;
		left: 0;
		top: 0;
	}
	.dist {
		font-weight: var(--weight-medium);
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}
	.dist.counting {
		position: relative;
	}
	.dist.counting .final {
		visibility: hidden;
	}
	.dist.counting .now {
		position: absolute;
		right: 0;
		top: 0;
	}
	.name {
		max-width: 10em;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Must match labelBox() in labels.ts: gap = dot radius (0.55rem) + 0.2rem. */
	.pos-n {
		bottom: 0.75rem;
		left: 0;
		transform: translateX(-50%);
	}
	.pos-s {
		top: 0.75rem;
		left: 0;
		transform: translateX(-50%);
	}
	.pos-e {
		left: 0.75rem;
		top: 0;
		transform: translateY(-50%);
	}
	.pos-w {
		right: 0.75rem;
		top: 0;
		transform: translateY(-50%);
	}
	.pos-ne {
		left: 0.5625rem;
		bottom: 0.5625rem;
	}
	.pos-nw {
		right: 0.5625rem;
		bottom: 0.5625rem;
	}
	.pos-se {
		left: 0.5625rem;
		top: 0.5625rem;
	}
	.pos-sw {
		right: 0.5625rem;
		top: 0.5625rem;
	}

	.me .dot {
		box-shadow:
			0 0 0 1px rgb(15 27 42 / 0.55),
			0 0 0 0.3rem color-mix(in srgb, var(--pin) 45%, transparent),
			0 2px 6px rgb(0 0 0 / 0.35);
	}
	.winner .dot {
		transform: scale(1.35);
		box-shadow:
			0 0 0 0.18rem var(--color-accent),
			0 2px 8px rgb(0 0 0 / 0.45);
	}
	.winner .label {
		background: var(--color-accent);
		color: var(--color-accent-contrast);
		font-size: 0.95rem;
		box-shadow:
			0 0 0 0.12rem rgb(255 255 255 / 0.9),
			0 2px 10px rgb(0 0 0 / 0.4);
	}
	.crown {
		width: 1.1em;
		height: 0.85em;
		fill: currentColor;
		flex: none;
	}
	.dim {
		opacity: 0.8;
	}
	.dim .label {
		opacity: 0.9;
	}

	/* Target */
	.target {
		position: absolute;
		left: 0;
		top: 0;
		width: 0;
		height: 0;
		z-index: 200;
	}
	.target-icon {
		position: absolute;
		left: -1.5rem;
		top: -1.5rem;
		width: 3rem;
		height: 3rem;
		overflow: visible;
		max-width: none;
		animation: target-in 650ms cubic-bezier(0.3, 1.5, 0.5, 1) both;
		filter: drop-shadow(0 2px 4px rgb(0 0 0 / 0.45));
	}
	.t-outer {
		fill: #ffffff;
	}
	.t-mid {
		fill: var(--color-danger);
	}
	.t-inner {
		fill: #ffffff;
	}
	.t-pulse {
		fill: none;
		stroke: var(--color-danger);
		stroke-width: 2.5;
		transform-origin: 0 0;
		animation: target-pulse 1.6s ease-out 650ms infinite;
	}

	@keyframes pin-in {
		from {
			opacity: 0;
			transform: translateY(-0.6rem) scale(0.6);
		}
	}
	@keyframes target-in {
		from {
			opacity: 0;
			transform: translateY(-2.5rem) scale(1.8);
		}
	}
	@keyframes target-pulse {
		0% {
			transform: scale(1);
			opacity: 0.9;
		}
		100% {
			transform: scale(2.6);
			opacity: 0;
		}
	}
</style>
