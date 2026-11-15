<!--
  Map preview of a location's point for the editor: the map agent's `StaticPointMap` in a fixed
  aspect-ratio frame (no layout jump while MapLibre loads). Clicking the map places the point.
-->
<script lang="ts">
	import StaticPointMap from '#lib/map/StaticPointMap.svelte';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';

	type Props = {
		lat: number | undefined;
		lng: number | undefined;
		zoom?: number;
		onpick?: (lat: number, lng: number) => void;
	};
	let { lat, lng, zoom = 4, onpick }: Props = $props();
	const t = useT(admin);
</script>

<div class="wrap">
	<div class="map">
		<StaticPointMap {lat} {lng} {zoom} {onpick} />
	</div>
	{#if onpick}<p class="hint">{t().mapPickHint}</p>{/if}
</div>

<style>
	.wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.map {
		position: relative;
		aspect-ratio: 16 / 10;
		border-radius: var(--radius-md);
		overflow: hidden;
		border: 1px solid var(--color-border);
		background: var(--color-ocean);
	}
	.map > :global(*) {
		position: absolute;
		inset: 0;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
