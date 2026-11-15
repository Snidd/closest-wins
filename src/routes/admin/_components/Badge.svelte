<!-- Small status pill. -->
<script lang="ts">
	import type { Snippet } from 'svelte';
	type Props = { tone?: 'neutral' | 'warn' | 'ok' | 'danger' | 'info'; title?: string; children: Snippet };
	let { tone = 'neutral', title, children }: Props = $props();
</script>

<span class={['badge', tone]} {title}>{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		padding: 0.1rem 0.5rem;
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		line-height: 1.5;
		white-space: nowrap;
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}
	.warn {
		background: color-mix(in srgb, var(--color-warning) 16%, transparent);
		color: var(--color-warning);
	}
	.ok {
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
		color: var(--color-success);
	}
	.danger {
		background: color-mix(in srgb, var(--color-danger) 14%, transparent);
		color: var(--color-danger);
	}
	.info {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
	}
</style>
