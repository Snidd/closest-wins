<!-- Game over: the winner(s), the final table and a note that the TV can be re-paired. -->
<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { host } from '#lib/i18n/host.ts';
	import StandingsTable from './StandingsTable.svelte';
	import { byJoinOrder, listNames, playerLookup, type HostPhase } from './types.ts';

	type Props = { snap: HostPhase<'finished'>; locale: Locale };
	let { snap, locale }: Props = $props();

	const t = useT(host);
	const who = $derived(playerLookup(snap.players, snap.standings));
	const names = $derived(byJoinOrder(snap.winnerPlayerIds, snap.players).map((id) => who(id).nickname));
</script>

<section class="hero" data-testid="final-winner">
	<span class="trophy" aria-hidden="true">🏆</span>
	<h2>
		{names.length === 0 ? t().noWinner : names.length === 1 ? t().winnerIs(names[0]!) : t().sharedWin(listNames(names, locale))}
	</h2>
	{#if snap.endedEarly}<p class="muted">{t().endedEarly}</p>{/if}
</section>

{#if snap.standings.length}
	<section class="card" aria-labelledby="final-title">
		<h3 id="final-title" class="eyebrow">{t().finalStandings}</h3>
		<StandingsTable rows={snap.standings} highlight={snap.winnerPlayerIds} />
	</section>
{/if}

{#if snap.tv.paired}
	<p class="tv-note" data-testid="tv-next-pairing">
		<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2" /><path d="M8 21h8" /></svg>
		<span>{t().tvNextPairing}</span>
	</p>
{/if}

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-2);
		padding: var(--space-6) var(--space-4) var(--space-5);
		border-radius: var(--radius-lg);
		background:
			radial-gradient(80% 90% at 50% 0%, color-mix(in oklab, var(--color-accent) 35%, transparent), transparent),
			var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.trophy {
		font-size: 3.5rem;
		line-height: 1;
	}
	h2 {
		font-size: var(--text-3xl);
		text-wrap: balance;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.eyebrow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.tv-note {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		border: 1px dashed var(--color-border);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.tv-note svg {
		flex: none;
		width: 1.5rem;
		height: 1.5rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
	}
</style>
