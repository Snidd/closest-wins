<!-- Paired TV status: connected (green) or disconnected (amber). -->
<script lang="ts">
	import type { HostTvStatus } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { host } from '#lib/i18n/host.ts';

	let { tv }: { tv: HostTvStatus } = $props();
	const t = useT(host);
</script>

{#if !tv.paired}
	<p class="status none" data-testid="tv-status" data-state="none">
		<span class="icon" aria-hidden="true">
			<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></svg>
		</span>
		<span class="text"><strong>{t().tvNotPaired}</strong></span>
	</p>
{:else if tv.connected}
	<p class="status ok" data-testid="tv-status" data-state="connected" role="status">
		<span class="icon" aria-hidden="true">
			<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
		</span>
		<span class="text">
			<strong>{t().tvConnected}</strong>
			<span>{t().tvConnectedBody}</span>
		</span>
	</p>
{:else}
	<p class="status warn" data-testid="tv-status" data-state="disconnected" role="status">
		<span class="icon" aria-hidden="true">
			<svg viewBox="0 0 24 24"><path d="M12 7v6M12 17v.5" /></svg>
		</span>
		<span class="text">
			<strong>{t().tvDisconnected}</strong>
			<span>{t().tvDisconnectedBody}</span>
		</span>
	</p>
{/if}

<style>
	.status {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
	}
	.icon {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
	}
	.icon svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.ok .icon {
		background: var(--color-success);
		color: #fff;
	}
	.warn .icon {
		background: var(--color-warning);
		color: #fff;
	}
	.none .icon {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}
	.none .icon svg {
		stroke-width: 2;
	}
	.text {
		display: flex;
		flex-direction: column;
		padding-top: 0.15rem;
	}
	.text strong {
		font-size: var(--text-lg);
	}
	.text span {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.none .text {
		padding-top: 0.5rem;
	}
</style>
