<!-- Friendly empty state with an optional call to action. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = { title: string; hint?: string; children?: Snippet };
	let { title, hint, children }: Props = $props();
</script>

<div class="empty">
	<div class="art" aria-hidden="true">
		<svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="24" cy="24" r="18" />
			<path d="M6 24h36M24 6c6 6 6 30 0 36M24 6c-6 6-6 30 0 36" />
		</svg>
	</div>
	<p class="title">{title}</p>
	{#if hint}<p class="muted">{hint}</p>{/if}
	{#if children}<div class="cta">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
		padding: var(--space-7) var(--space-4);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-lg);
	}
	.art {
		color: var(--color-text-muted);
		opacity: 0.6;
	}
	.title {
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
	}
	.cta {
		margin-top: var(--space-2);
	}
</style>
