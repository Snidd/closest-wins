<!-- Inline error state with an optional retry. -->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { message: string; detail?: string; hint?: string; onretry?: () => void };
	let { message, detail, hint, onretry }: Props = $props();
	const c = useT(common);
</script>

<div class="error" role="alert">
	<p class="message">{message}</p>
	{#if hint}<p class="muted">{hint}</p>{/if}
	{#if detail}<p class="detail">{detail}</p>{/if}
	{#if onretry}
		<div><Button variant="secondary" size="sm" onclick={onretry}>{c().retry}</Button></div>
	{/if}
</div>

<style>
	.error {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border: 1px solid color-mix(in srgb, var(--color-danger) 40%, var(--color-border));
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-danger) 6%, var(--color-surface));
	}
	.message {
		font-weight: var(--weight-bold);
	}
	.detail {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}
</style>
