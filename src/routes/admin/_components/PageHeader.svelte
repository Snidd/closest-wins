<!-- Page title with an optional back link (breadcrumb) and actions on the right. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title: string;
		back?: { href: string; label: string };
		subtitle?: string;
		actions?: Snippet;
	};
	let { title, back, subtitle, actions }: Props = $props();
</script>

<header class="head">
	<div class="titles">
		{#if back}
			<a class="back" href={back.href}><span aria-hidden="true">←</span> {back.label}</a>
		{/if}
		<h1>{title}</h1>
		{#if subtitle}<p class="muted">{subtitle}</p>{/if}
	</div>
	{#if actions}
		<div class="actions">{@render actions()}</div>
	{/if}
</header>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: var(--space-3) var(--space-4);
		margin-bottom: var(--space-5);
	}
	.titles {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	h1 {
		font-size: var(--text-2xl);
		overflow-wrap: anywhere;
	}
	.back {
		font-size: var(--text-sm);
		text-decoration: none;
		color: var(--color-text-muted);
	}
	.back:hover {
		color: var(--color-primary);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
