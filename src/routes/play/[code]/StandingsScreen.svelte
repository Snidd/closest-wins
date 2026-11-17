<!-- Between rounds: what comes next, the player's last round in brief, and the table. -->
<script lang="ts">
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { gameTeamName } from '#lib/game/teams.ts';
	import { player } from '#lib/i18n/player.ts';
	import Shell from './Shell.svelte';
	import RoundOutcome from './RoundOutcome.svelte';
	import StandingsTable from './StandingsTable.svelte';
	import type { Snap } from './types.ts';

	let { s }: { s: Snap<'standings'> } = $props();
	const t = useT(player);
	const locale = useLocale();

	const nick = (id: string) => s.players.find((p) => p.id === id)?.nickname ?? '?';
	const next = $derived(s.next);
	const inSuddenDeath = $derived(next.kind === 'suddenDeath' && next.eligiblePlayerIds.includes(s.me.id));
	const r = $derived(s.result.round);
	/** Who plays sudden death: the tied teams in a teams game, else the tied players. */
	const tied = $derived(
		next.kind !== 'suddenDeath'
			? ''
			: next.teams
				? t().list(next.teams.map((i) => gameTeamName(s.game, i, locale())))
				: t().list(next.eligiblePlayerIds.map(nick))
	);
	const caption = $derived(r.isSuddenDeath ? t().afterSuddenDeath : t().afterRound(r.number));
</script>

<Shell testid="standings-screen" tone={inSuddenDeath ? 'danger' : 'default'}>
	{#snippet label()}{t().standings}{/snippet}

	<p class={['next', next.kind, { in: inSuddenDeath }]} data-testid="next-step" data-kind={next.kind}>
		{#if next.kind === 'round'}
			{t().nextRound(next.number, s.game.totalRounds)}
		{:else if next.kind === 'suddenDeath'}
			{#if inSuddenDeath}
				{t().nextSuddenDeathIn}
			{:else}
				{t().nextSuddenDeathOut(tied)}
			{/if}
		{:else}
			{t().nextFinish}
		{/if}
	</p>

	<StandingsTable rows={s.standings} meId={s.me.id} {caption} teams={s.teamStandings} myTeam={s.me.team} />

	<div class="last">
		<h2>{t().yourRound}</h2>
		<RoundOutcome {s} compact />
	</div>
</Shell>

<style>
	.next {
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		border-left: 5px solid var(--color-primary);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		line-height: 1.3;
		text-wrap: pretty;
	}
	.next.suddenDeath {
		border-left-color: var(--color-danger);
	}
	.next.suddenDeath.in {
		background: var(--color-danger);
		color: var(--color-danger-contrast);
		border-left-color: transparent;
		animation: throb 1.8s ease-in-out infinite;
	}
	.next.finish {
		border-left-color: var(--color-accent);
	}
	@keyframes throb {
		50% {
			box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-danger) 25%, transparent);
		}
	}
	.last {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.last :global([data-testid='own-result']) {
		padding-top: var(--space-4);
	}
</style>
