<!--
  Internal: the attribution line and the loading / error overlay shared by the map components.
-->
<script lang="ts">
	import { dev } from '$app/env';
	import { useT } from '#lib/i18n/context.ts';
	import { map as mapDict } from '#lib/i18n/map.ts';
	import type { Corner, MapFailure } from './base.ts';
	import { ATTRIBUTION_HTML } from './config.ts';

	type Props = {
		status: 'loading' | 'ready' | 'error';
		failure?: MapFailure | null;
		attribution?: Corner | false;
		/** Smaller error text for small maps (admin preview). */
		compact?: boolean;
	};

	let { status, failure = null, attribution = 'bottom-right', compact = false }: Props = $props();
	const t = useT(mapDict);
</script>

{#if attribution}
	<div class={['attribution', attribution]}>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- constant from config.ts -->
		{@html ATTRIBUTION_HTML}
	</div>
{/if}

{#if status === 'error'}
	<div class={['error', { compact }]} role="alert">
		<p class="title">{t().loadErrorTitle}</p>
		{#if failure === 'tiles'}
			<p>{t().tilesMissing}</p>
			{#if dev}<p class="hint">{t().tilesMissingDev}</p>{/if}
		{:else if failure === 'webgl'}
			<p>{t().webglError}</p>
		{/if}
		{#if !compact}
			<button type="button" onclick={() => location.reload()}>{t().retry}</button>
		{/if}
	</div>
{/if}

<style>
	.attribution {
		position: absolute;
		z-index: 3;
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
		background: color-mix(in srgb, var(--color-surface) 65%, transparent);
		color: var(--color-text-muted);
		font-size: 0.625rem;
		line-height: 1.4;
		white-space: nowrap;
		pointer-events: auto;
		opacity: 0.85;
	}
	.attribution :global(a) {
		color: inherit;
		text-decoration: none;
	}
	.top-left {
		top: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-top));
		left: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-left));
	}
	.top-right {
		top: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-top));
		right: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-right));
	}
	.bottom-left {
		bottom: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-bottom));
		left: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-left));
	}
	.bottom-right {
		bottom: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-bottom));
		right: calc(var(--map-attribution-inset, 0.25rem) + var(--safe-right));
	}

	.error {
		position: absolute;
		inset: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-5);
		text-align: center;
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.title {
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
	}
	.hint {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.compact {
		padding: var(--space-3);
		font-size: var(--text-sm);
	}
	.compact .title {
		font-size: var(--text-md);
	}
	button {
		margin-top: var(--space-2);
		min-height: var(--tap-target);
		padding: 0 var(--space-5);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-weight: var(--weight-bold);
		cursor: pointer;
	}
</style>
