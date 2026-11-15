<!--
  Small preview map with one marker (admin location editor). Without `onpick` it is static;
  with `onpick` it is lightly interactive (drag to pan, wheel / pinch / double click to zoom)
  and a click places the point: `onpick(lat, lng)` with lng normalised to [-180, 180].

  ```svelte
  <div style="height: 240px">
  	<StaticPointMap {lat} {lng} onpick={(la, ln) => { lat = la; lng = ln; }} />
  </div>
  ```

  `lat` / `lng` may be null/undefined/NaN while the inputs are empty: then no marker is shown.
  When the point changes and is outside the visible area, the map recentres on it.
-->
<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { untrack } from 'svelte';
	import { clampLat, normalizeLng } from '#lib/geo.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { map as mapDict } from '#lib/i18n/map.ts';
	import { createMap, MapInitError, onTileError, setMapTheme, type MapFailure, type MaplibreMap } from './base.ts';
	import { MIN_ZOOM, WORLD_VIEW } from './config.ts';
	import { unwrapLng, worldFitZoom } from './geometry.ts';
	import MapChrome from './MapChrome.svelte';
	import type { MapTheme } from './style.ts';
	import { useMapTheme } from './theme.svelte.ts';

	type Props = {
		lat: number | null | undefined;
		lng: number | null | undefined;
		/** Zoom when showing a point (default 4). */
		zoom?: number;
		/** Click to place the point (enables light interaction). Read once on mount. */
		onpick?: (lat: number, lng: number) => void;
		theme?: MapTheme | 'auto';
		class?: string;
	};

	let { lat, lng, zoom = 4, onpick, theme: themeProp = 'auto', class: className }: Props = $props();

	const t = useT(mapDict);
	const theme = useMapTheme(() => themeProp);

	let container: HTMLDivElement;
	let map: MaplibreMap | undefined = $state.raw();
	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let failure = $state<MapFailure | null>(null);
	let markerPos = $state.raw<{ x: number; y: number } | null>(null);

	const point = $derived(
		typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
			? { lat: clampLat(lat), lng: normalizeLng(lng) }
			: null
	);

	function updateMarker() {
		const m = map;
		if (!m || !point) {
			markerPos = null;
			return;
		}
		const p = m.project([unwrapLng(point.lng, m.getCenter().lng), point.lat]);
		markerPos = { x: p.x, y: p.y };
	}

	$effect(() => {
		let cancelled = false;
		let instance: MaplibreMap | undefined;
		const [p, z, th, pick] = untrack(() => [point, zoom, theme(), onpick] as const);
		const interactive = !!pick;
		mapTheme = th;

		createMap(container, th, {
			center: p ? [p.lng, p.lat] : WORLD_VIEW.center,
			zoom: p ? z : worldFitZoom(container.clientWidth, MIN_ZOOM, WORLD_VIEW.zoom),
			interactive,
			keyboard: false,
			touchZoomRotate: interactive,
			doubleClickZoom: interactive,
			scrollZoom: interactive,
			dragPan: interactive
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
				m.on('move', updateMarker);
				m.on('resize', updateMarker);
				if (pick) {
					m.on('click', (e) => onpick?.(clampLat(e.lngLat.lat), normalizeLng(e.lngLat.lng)));
				}
				m.once('load', () => {
					if (cancelled) return;
					map = m;
					if (status !== 'error') status = 'ready';
					updateMarker();
				});
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				failure = e instanceof MapInitError ? e.kind : 'other';
				status = 'error';
				console.error('[StaticPointMap]', e);
			});

		return () => {
			cancelled = true;
			instance?.remove();
			map = undefined;
		};
	});

	// Follow the point: recentre when it leaves the inner area of the view.
	$effect(() => {
		const m = map;
		const p = point;
		if (!m) return;
		untrack(() => {
			if (p) {
				const px = m.project([unwrapLng(p.lng, m.getCenter().lng), p.lat]);
				const w = container.clientWidth;
				const h = container.clientHeight;
				const inside = px.x > w * 0.1 && px.x < w * 0.9 && px.y > h * 0.1 && px.y < h * 0.9;
				if (!inside) m.easeTo({ center: [p.lng, p.lat], zoom: Math.max(m.getZoom(), Math.min(zoom, 3)), duration: 400 });
			}
			updateMarker();
		});
	});

	/** Theme the map currently shows (it may change before the map has loaded). */
	let mapTheme: MapTheme | undefined;
	$effect(() => {
		const th = theme();
		if (map && th !== mapTheme) {
			setMapTheme(map, th);
			mapTheme = th;
		}
	});
</script>

<div class={['point-map', { pickable: !!onpick }, className]} data-status={status}>
	<div
		class="canvas"
		bind:this={container}
		role="img"
		aria-label={onpick ? `${t().previewLabel}. ${t().pickHint}` : t().previewLabel}
	></div>
	{#if markerPos}
		<div class="marker" style:transform="translate({markerPos.x}px, {markerPos.y}px)" aria-hidden="true">
			<svg viewBox="-16 -16 32 32">
				<circle class="outer" r="9" />
				<circle class="mid" r="5.5" />
				<circle class="inner" r="2.2" />
			</svg>
		</div>
	{/if}
	<MapChrome {status} {failure} compact attribution="bottom-right" />
</div>

<style>
	.point-map {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 8rem;
		overflow: hidden;
		border-radius: inherit;
		background: var(--color-ocean);
	}
	.canvas {
		position: absolute;
		inset: 0;
	}
	.pickable .canvas :global(.maplibregl-canvas-container) {
		cursor: crosshair;
	}
	.marker {
		position: absolute;
		left: 0;
		top: 0;
		z-index: 2;
		pointer-events: none;
	}
	.marker svg {
		position: absolute;
		left: -16px;
		top: -16px;
		width: 32px;
		height: 32px;
		overflow: visible;
		max-width: none;
		filter: drop-shadow(0 1px 3px rgb(0 0 0 / 0.5));
	}
	.outer {
		fill: #ffffff;
	}
	.mid {
		fill: var(--color-danger);
	}
	.inner {
		fill: #ffffff;
	}
</style>
