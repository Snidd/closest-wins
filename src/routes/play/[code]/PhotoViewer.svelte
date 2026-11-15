<!--
  Full-screen clue photo. Pinch (or double tap) to zoom, drag to pan when zoomed, swipe down,
  ×, Escape or the phone's Back button to close. The page itself never zooms (play surface).
-->
<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { PhotoView } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';

	type Props = { photo: PhotoView; alt: string; onclose: () => void };
	let { photo, alt, onclose }: Props = $props();
	const t = useT(player);

	const MAX_SCALE = 5;
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);
	let dragging = $state(false);
	let stage: HTMLDivElement;
	let img: HTMLImageElement;
	let closeBtn: HTMLButtonElement;

	type Pt = { x: number; y: number };
	const pointers = new Map<number, Pt>();
	let pinch: { dist: number; mid: Pt; scale: number; tx: number; ty: number } | null = null;
	let pan: { start: Pt; tx: number; ty: number } | null = null;
	let tap: { at: number; pt: Pt; moved: boolean } | null = null;
	let lastTapAt = 0;

	/** Coordinates relative to the stage centre (the transform origin). */
	function rel(e: PointerEvent): Pt {
		const r = stage.getBoundingClientRect();
		return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
	}
	const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
	const midpoint = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	function clampPan(s: number, x: number, y: number) {
		const r = stage.getBoundingClientRect();
		const bx = Math.max(0, (img.clientWidth * s - r.width) / 2);
		const by = Math.max(0, (img.clientHeight * s - r.height) / 2);
		return { x: Math.min(bx, Math.max(-bx, x)), y: Math.min(by, Math.max(-by, y)) };
	}

	/** Zoom to `s`, keeping the image point under `anchor` (stage-relative) in place. */
	function zoomAround(s: number, anchor: Pt, from = { scale, tx, ty }) {
		const qx = (anchor.x - from.tx) / from.scale;
		const qy = (anchor.y - from.ty) / from.scale;
		const c = clampPan(s, anchor.x - s * qx, anchor.y - s * qy);
		scale = s;
		tx = c.x;
		ty = c.y;
	}

	function reset() {
		scale = 1;
		tx = 0;
		ty = 0;
	}

	function onpointerdown(e: PointerEvent) {
		if ((e.target as Element).closest('button, a')) return;
		stage.setPointerCapture(e.pointerId);
		const p = rel(e);
		pointers.set(e.pointerId, p);
		dragging = true;
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()] as [Pt, Pt];
			pinch = { dist: Math.max(1, dist(a, b)), mid: midpoint(a, b), scale, tx, ty };
			pan = null;
			tap = null;
		} else if (pointers.size === 1) {
			pan = { start: p, tx, ty };
			tap = { at: performance.now(), pt: p, moved: false };
		}
	}

	function onpointermove(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		const p = rel(e);
		pointers.set(e.pointerId, p);
		if (pinch && pointers.size >= 2) {
			const [a, b] = [...pointers.values()] as [Pt, Pt];
			const s = Math.min(MAX_SCALE, Math.max(1, pinch.scale * (dist(a, b) / pinch.dist)));
			// Keep the image point under the starting midpoint under the moving midpoint.
			const m = midpoint(a, b);
			const qx = (pinch.mid.x - pinch.tx) / pinch.scale;
			const qy = (pinch.mid.y - pinch.ty) / pinch.scale;
			const c = clampPan(s, m.x - s * qx, m.y - s * qy);
			scale = s;
			tx = c.x;
			ty = c.y;
		} else if (pan) {
			const dx = p.x - pan.start.x;
			const dy = p.y - pan.start.y;
			if (tap && Math.hypot(dx, dy) > 10) tap.moved = true;
			if (scale > 1) {
				const c = clampPan(scale, pan.tx + dx, pan.ty + dy);
				tx = c.x;
				ty = c.y;
			} else {
				// Not zoomed: vertical drag previews swipe-to-close.
				tx = 0;
				ty = Math.max(0, dy);
			}
		}
	}

	function onpointerup(e: PointerEvent) {
		if (!pointers.has(e.pointerId)) return;
		pointers.delete(e.pointerId);
		if (pointers.size === 1) {
			// Pinch → one finger left: continue as a pan from here.
			pinch = null;
			const [p] = [...pointers.values()] as [Pt];
			pan = { start: p, tx, ty };
			return;
		}
		if (pointers.size > 0) return;
		dragging = false;
		pinch = null;

		if (scale <= 1.02) {
			if (ty > 110 && e.type === 'pointerup') {
				onclose();
				return;
			}
			reset();
		}

		const wasTap = tap && !tap.moved && performance.now() - tap.at < 300 && e.type === 'pointerup';
		const tapPt = tap?.pt;
		pan = null;
		tap = null;
		if (wasTap && tapPt) {
			const now = performance.now();
			if (now - lastTapAt < 320) {
				lastTapAt = 0;
				if (scale > 1) reset();
				else zoomAround(2.5, tapPt, { scale: 1, tx: 0, ty: 0 });
			} else {
				lastTapAt = now;
			}
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	$effect(() => {
		const previous = document.activeElement as HTMLElement | null;
		closeBtn.focus({ preventScroll: true });
		return () => previous?.focus?.({ preventScroll: true });
	});

	const swipe = $derived(scale <= 1 ? Math.min(1, ty / 300) : 0);
</script>

<svelte:window {onkeydown} />

<div
	class="viewer"
	role="dialog"
	aria-modal="true"
	aria-label={alt}
	style:--swipe={swipe}
	transition:fade={{ duration: 160 }}
	data-testid="photo-viewer"
>
	<div
		class="stage"
		bind:this={stage}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		role="presentation"
	>
		<img
			bind:this={img}
			src={photo.urls.lg}
			srcset="{photo.urls.md} {1024}w, {photo.urls.lg} {1920}w"
			sizes="100vw"
			width={photo.width}
			height={photo.height}
			{alt}
			draggable="false"
			class={{ dragging }}
			style:transform="translate3d({tx}px, {ty}px, 0) scale({scale})"
		/>
	</div>

	<button type="button" class="close" bind:this={closeBtn} onclick={onclose} aria-label={t().closePhoto}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
	</button>

	<div class="caption">
		<p class="hint">{t().photoHint}</p>
		{#if photo.attribution}
			<p class="credit">{t().photoBy(photo.attribution)}</p>
		{/if}
	</div>
</div>

<style>
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgb(0 0 0 / calc(0.97 - var(--swipe) * 0.6));
		color: #fff;
		touch-action: none;
	}
	.stage {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		overflow: hidden;
		touch-action: none;
	}
	img {
		max-width: 100%;
		max-height: 100%;
		width: auto;
		height: auto;
		object-fit: contain;
		transform-origin: center center;
		transition: transform var(--duration-normal) var(--ease-out);
		will-change: transform;
		-webkit-user-drag: none;
		user-select: none;
	}
	img.dragging {
		transition: none;
	}
	.close {
		position: absolute;
		top: calc(var(--safe-top) + var(--space-3));
		right: calc(var(--safe-right) + var(--space-3));
		display: grid;
		place-items: center;
		width: 3rem;
		height: 3rem;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.16);
		color: #fff;
		cursor: pointer;
		backdrop-filter: blur(6px);
	}
	.close svg {
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.caption {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-3) + var(--safe-bottom))
			calc(var(--space-4) + var(--safe-left));
		background: linear-gradient(transparent, rgb(0 0 0 / 0.55));
		text-align: center;
		font-size: var(--text-xs);
		pointer-events: none;
		opacity: calc(1 - var(--swipe));
	}
	.hint {
		opacity: 0.75;
	}
	.credit {
		opacity: 0.6;
		margin-top: var(--space-1);
	}
</style>
