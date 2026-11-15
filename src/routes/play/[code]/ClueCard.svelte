<!--
  Compact clue over the top of the map: photo thumbnail (opens the full-screen viewer) and/or
  the text, readable at a glance. Long text is clamped and expands on tap; the whole card
  collapses to a small "Show clue" pill. Its height is capped so the centre cross stays clear.
  The viewer is a shallow history entry, so the phone's Back button closes it.
-->
<script lang="ts">
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import type { ClueView } from '#lib/game/types.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';
	import PhotoViewer from './PhotoViewer.svelte';

	type Props = { clue: ClueView; roundIndex: number; collapsed?: boolean };
	let { clue, roundIndex, collapsed = $bindable(false) }: Props = $props();
	const t = useT(player);
	const locale = useLocale();

	const text = $derived(localized(clue, 'text', locale()));
	const photo = $derived(clue.photo);

	let expanded = $state(false);
	let textEl = $state<HTMLSpanElement>();
	let overflowing = $state(false);

	$effect(() => {
		if (!textEl) return;
		const el = textEl;
		const measure = () => {
			if (!expanded) overflowing = el.scrollHeight > el.clientHeight + 1;
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	type ViewerState = { cluePhoto?: number };
	const viewerOpen = $derived((page.state as ViewerState).cluePhoto === roundIndex);
	let localOpen = $state(false);
	const open = $derived(viewerOpen || localOpen);

	function openViewer() {
		try {
			pushState('', { cluePhoto: roundIndex } as App.PageState);
		} catch {
			localOpen = true;
		}
	}
	function closeViewer() {
		localOpen = false;
		if (viewerOpen) history.back();
	}
</script>

{#if collapsed}
	<button type="button" class="pill" onclick={() => (collapsed = false)} data-testid="show-clue">
		{#if photo}<img src={photo.urls.sm} alt="" width="28" height="28" />{/if}
		<span>{t().showClue}</span>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
	</button>
{:else}
	<section class={['clue', { 'photo-only': photo && !text, expanded }]} aria-label={t().clue} data-testid="clue">
		{#if photo}
			<button
				type="button"
				class="thumb"
				onclick={openViewer}
				aria-label={t().openPhoto}
				data-testid="clue-photo"
				style:aspect-ratio={!text ? `${photo.width} / ${photo.height}` : undefined}
			>
				<img src={photo.urls.sm} alt="" width={photo.width} height={photo.height} />
				<span class="zoom" aria-hidden="true"
					><svg viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg></span
				>
			</button>
		{/if}
		{#if text}
			<div class="text-wrap scrollable">
				<button
					type="button"
					class="text-btn"
					aria-expanded={overflowing || expanded ? expanded : undefined}
					onclick={() => {
						if (overflowing || expanded) expanded = !expanded;
					}}
				>
					<span class="text" bind:this={textEl} data-testid="clue-text">{text}</span>
				</button>
			</div>
		{/if}
		<button type="button" class="hide" onclick={() => (collapsed = true)} aria-label={t().hideClue} data-testid="hide-clue">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
		</button>
	</section>
{/if}

{#if open && photo}
	<PhotoViewer {photo} alt={text || t().clue} onclose={closeViewer} />
{/if}

<style>
	.clue {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-2);
		padding-right: 2.75rem;
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(8px);
		max-height: var(--clue-max, 30dvh);
		animation: in var(--duration-normal) var(--ease-out);
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
	}
	.thumb {
		position: relative;
		flex: none;
		width: 4.5rem;
		height: 4.5rem;
		padding: 0;
		border: 0;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-surface-2);
		cursor: zoom-in;
	}
	.photo-only .thumb {
		width: auto;
		height: auto;
		max-width: 100%;
		max-height: calc(var(--clue-max, 30dvh) - 1rem);
		min-height: 5rem;
	}
	.photo-only {
		justify-content: flex-start;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.zoom {
		position: absolute;
		right: 0.25rem;
		bottom: 0.25rem;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.55);
	}
	.zoom svg {
		width: 0.85rem;
		height: 0.85rem;
		fill: none;
		stroke: #fff;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.text-wrap {
		position: relative;
		flex: 1;
		min-width: 0;
		max-height: calc(var(--clue-max, 30dvh) - 1rem);
		align-self: center;
		padding: var(--space-1) 0 var(--space-1) var(--space-1);
	}
	.text-btn {
		position: relative;
		display: block;
		width: 100%;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		text-align: start;
		cursor: default;
	}
	.text {
		font-size: var(--text-lg);
		font-weight: var(--weight-medium);
		line-height: 1.3;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		text-wrap: pretty;
		overflow-wrap: anywhere;
	}
	.expanded .text {
		display: block;
		-webkit-line-clamp: unset;
		line-clamp: unset;
	}
	.hide,
	.pill {
		cursor: pointer;
		color: var(--color-text-muted);
	}
	.hide {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
	}
	svg {
		width: 1.25rem;
		height: 1.25rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		align-self: flex-start;
		min-height: 2.75rem;
		padding: 0.25rem var(--space-3) 0.25rem 0.375rem;
		border: 0;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--color-surface) 94%, transparent);
		box-shadow: var(--shadow-md);
		color: var(--color-text);
		font-weight: var(--weight-medium);
		font-size: var(--text-sm);
	}
	.pill img {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		object-fit: cover;
	}
	.pill:not(:has(img)) {
		padding-left: var(--space-4);
	}
</style>
