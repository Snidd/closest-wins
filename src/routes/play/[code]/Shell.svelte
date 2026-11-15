<!--
  Layout for every non-map player screen: a slim top bar (brand, optional label on the right),
  a scrollable body and an optional footer pinned above the home indicator.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import mark from '#lib/assets/favicon.svg';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';

	type Props = {
		/** Right side of the top bar (e.g. round label). */
		label?: Snippet;
		footer?: Snippet;
		children: Snippet;
		/** Centre the body vertically (short status screens). */
		center?: boolean;
		/** Tint behind the top of the page. */
		tone?: 'default' | 'win' | 'danger';
		testid?: string;
	};
	let { label, footer, children, center = false, tone = 'default', testid }: Props = $props();
	const tc = useT(common);
</script>

<div class={['shell', `tone-${tone}`]} data-testid={testid}>
	<header class="bar">
		<span class="brand">
			<img src={mark} alt="" width="24" height="24" />
			<span>{tc().appName}</span>
		</span>
		{#if label}<span class="label">{@render label()}</span>{/if}
	</header>
	<main class={['body', 'scrollable', { center }]}>
		<div class="inner">
			{@render children()}
		</div>
	</main>
	{#if footer}
		<footer class="footer">{@render footer()}</footer>
	{/if}
</div>

<style>
	.shell {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
	}
	.tone-default {
		background:
			radial-gradient(120% 40% at 50% 0%, color-mix(in oklab, var(--color-primary) 13%, transparent), transparent 70%),
			var(--color-bg);
	}
	.tone-win {
		background:
			radial-gradient(130% 50% at 50% 0%, color-mix(in oklab, var(--color-accent) 30%, transparent), transparent 72%),
			var(--color-bg);
	}
	.tone-danger {
		background:
			radial-gradient(130% 45% at 50% 0%, color-mix(in oklab, var(--color-danger) 18%, transparent), transparent 72%),
			var(--color-bg);
	}
	.bar {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: calc(var(--safe-top) + 3rem);
		padding: var(--safe-top) calc(var(--space-4) + var(--safe-right)) 0 calc(var(--space-4) + var(--safe-left));
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-weight: var(--weight-bold);
		font-size: var(--text-sm);
		min-width: 0;
		white-space: nowrap;
	}
	.brand img {
		border-radius: 0.35rem;
	}
	.label {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.inner {
		width: 100%;
		max-width: 28rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-6) + var(--safe-bottom))
			calc(var(--space-4) + var(--safe-left));
	}
	.center .inner {
		margin-block: auto;
	}
	.footer {
		flex: none;
		width: 100%;
		max-width: 28rem;
		margin-inline: auto;
		padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-4) + var(--safe-bottom))
			calc(var(--space-4) + var(--safe-left));
	}
</style>
