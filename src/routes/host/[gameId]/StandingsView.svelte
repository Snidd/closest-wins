<!-- Between rounds: the table and what the next tap will do. -->
<script lang="ts">
	import type { Locale } from '#lib/i18n/index.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { host } from '#lib/i18n/host.ts';
	import { gameTeamName } from '#lib/game/teams.ts';
	import StandingsTable from './StandingsTable.svelte';
	import { listNames, playerLookup, type HostPhase } from './types.ts';

	type Props = { snap: HostPhase<'standings'>; locale: Locale };
	let { snap, locale }: Props = $props();

	const t = useT(host);
	const who = $derived(playerLookup(snap.players, snap.standings));
	const round = $derived(snap.result.round);
	const tiedTeams = $derived(snap.next.kind === 'suddenDeath' ? snap.next.teams : undefined);
	const tied = $derived(
		snap.next.kind !== 'suddenDeath'
			? ''
			: tiedTeams
				? listNames(tiedTeams.map((i) => gameTeamName(snap.game, i, locale)), locale)
				: listNames(snap.next.eligiblePlayerIds.map((id) => who(id).nickname), locale)
	);
	const leaders = $derived(snap.next.kind === 'suddenDeath' ? snap.next.eligiblePlayerIds : []);
</script>

<section class="card" aria-labelledby="standings-title">
	<h2 id="standings-title" class="eyebrow">
		{round.isSuddenDeath ? t().afterSuddenDeath : t().afterRound(round.number, snap.game.totalRounds)}
	</h2>
	<StandingsTable rows={snap.standings} highlight={leaders} teams={snap.teamStandings} highlightTeams={tiedTeams} />
</section>

{#if snap.next.kind === 'suddenDeath'}
	<section class="sd" data-testid="sudden-death-explain">
		<span class="bolt" aria-hidden="true">⚡</span>
		<p>{tiedTeams ? t().suddenDeathTeamsExplain(tied) : t().suddenDeathExplain(tied)}</p>
	</section>
{:else if snap.next.kind === 'finish'}
	<p class="muted center">{t().finalNext}</p>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
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
	.sd {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--color-accent) 12%, var(--color-surface));
		border: 2px solid color-mix(in oklab, var(--color-accent) 70%, transparent);
		font-weight: var(--weight-medium);
	}
	.bolt {
		font-size: var(--text-xl);
		line-height: 1.2;
	}
	.center {
		text-align: center;
	}
</style>
