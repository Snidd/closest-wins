<!--
  Unobtrusive "reconnecting" pill. Kit reconnects the live stream by itself; this only tells the
  player why nothing is moving. Shown after a grace period so short blips (and hydration) do not
  flash it.
-->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';

	let { connected }: { connected: boolean } = $props();
	const t = useT(player);

	let show = $state(false);
	let online = $state(true);

	$effect(() => {
		if (connected) {
			show = false;
			return;
		}
		const id = setTimeout(() => (show = true), 2500);
		return () => clearTimeout(id);
	});

	$effect(() => {
		const update = () => (online = navigator.onLine);
		update();
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});
</script>

{#if show}
	<div class="badge" role="status" data-testid="connection-badge">
		<span class="spinner" aria-hidden="true"></span>
		{online ? t().reconnecting : t().offline}
	</div>
{/if}

<style>
	.badge {
		position: fixed;
		z-index: 50;
		left: 50%;
		bottom: calc(var(--safe-bottom) + 6.5rem);
		transform: translateX(-50%);
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		max-width: calc(100vw - 2rem);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--color-text) 88%, transparent);
		color: var(--color-bg);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		box-shadow: var(--shadow-md);
		pointer-events: none;
		animation: in var(--duration-normal) var(--ease-out);
	}
	.spinner {
		flex: none;
		width: 0.9rem;
		height: 0.9rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translate(-50%, 0.5rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
			border-right-color: currentColor;
			opacity: 0.6;
		}
	}
</style>
