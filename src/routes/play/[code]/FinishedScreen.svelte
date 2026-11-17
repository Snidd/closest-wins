<!--
  Game over: winner(s), the player's own placement, final table, way back to the start. In a
  teams game: the winning team(s) with their members, and the own team's placement.
-->
<script lang="ts">
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { gameTeamName } from '#lib/game/teams.ts';
	import { player } from '#lib/i18n/player.ts';
	import Button from '#lib/ui/Button.svelte';
	import Shell from './Shell.svelte';
	import StandingsTable from './StandingsTable.svelte';
	import Pin from './Pin.svelte';
	import type { Snap } from './types.ts';

	let { s }: { s: Snap<'finished'> } = $props();
	const t = useT(player);
	const locale = useLocale();

	const winners = $derived(s.winnerPlayerIds);
	const winnerTeams = $derived(s.winnerTeams ?? []);
	const teamGame = $derived(s.winnerTeams !== undefined);
	const myTeamWon = $derived(s.me.team !== undefined && winnerTeams.includes(s.me.team));
	const teamNames = $derived(t().list(winnerTeams.map((i) => gameTeamName(s.game, i, locale()))));
	const myTeamRow = $derived(s.teamStandings?.find((r) => r.team === s.me.team));
	const iWon = $derived(teamGame ? myTeamWon : winners.includes(s.me.id));
	const shared = $derived(winners.length > 1);
	const nick = (id: string) =>
		s.players.find((p) => p.id === id)?.nickname ?? s.standings.find((r) => r.playerId === id)?.nickname ?? '?';
	const colorOf = (id: string) =>
		s.players.find((p) => p.id === id)?.color ?? s.standings.find((r) => r.playerId === id)?.color ?? '#888888';
	const myRow = $derived(s.standings.find((r) => r.playerId === s.me.id));
	const kind = $derived((teamGame ? winnerTeams : winners).length === 0 ? 'nobody' : iWon ? 'me' : 'other');

	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});
	const confetti = $derived(
		mounted && iWon && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? Array.from({ length: 28 }, (_, i) => ({
					left: Math.random() * 100,
					delay: Math.random() * 1.2,
					duration: 2.4 + Math.random() * 1.8,
					rotate: Math.random() * 360,
					color: [s.me.color, 'var(--color-accent)', 'var(--color-primary)', 'var(--color-success)'][i % 4]!
				}))
			: []
	);
</script>

<Shell tone={kind === 'me' ? 'win' : 'default'} testid="finished-screen">
	{#snippet label()}{t().gameOver}{/snippet}
	{#snippet footer()}
		<Button href="/" size="lg" block variant="secondary">{t().backToStart}</Button>
	{/snippet}

	<section
		class={['hero', kind]}
		data-testid="finish-hero"
		data-kind={kind}
		data-winner-teams={s.winnerTeams?.join(',')}
	>
		{#if kind === 'nobody'}
			<h1>{t().nobodyWon}</h1>
			<p class="muted">{t().nobodyWonBody}</p>
		{:else}
			<div class="pins" aria-hidden="true">
				{#each winners as id (id)}
					<Pin color={colorOf(id)} size={winners.length > 2 ? '2.25rem' : '3rem'} />
				{/each}
			</div>
			<h1 data-testid="finish-title">
				{#if teamGame}
					{#if myTeamWon}
						{winnerTeams.length > 1 ? t().yourTeamSharedWin : t().yourTeamWon}
					{:else}
						{winnerTeams.length > 1 ? t().sharedWin(teamNames) : t().winnerIs(teamNames)}
					{/if}
				{:else if iWon}
					{shared ? t().youSharedWin : t().youWon}
				{:else if shared}
					{t().sharedWin(t().list(winners.map(nick)))}
				{:else}
					{t().winnerIs(nick(winners[0]!))}
				{/if}
			</h1>
			{#if teamGame}
				<p class="muted" data-testid="winner-members">
					{#if myTeamWon}{teamNames} · {/if}{t().list(winners.map(nick))}
				</p>
			{:else if iWon && shared}
				<p class="muted">{t().list(winners.filter((id) => id !== s.me.id).map(nick))}</p>
			{/if}
		{/if}
		{#if teamGame && myTeamRow && kind === 'other'}
			<p class="place" data-testid="my-place">
				{t().yourTeamFinished(t().ordinal(myTeamRow.rank), s.teamStandings!.length)}
			</p>
		{:else if !teamGame && myRow && kind === 'other'}
			<p class="place" data-testid="my-place">
				{t().youFinished(t().ordinal(myRow.rank), s.standings.length)}
			</p>
		{/if}
		{#if s.endedEarly}<p class="muted small">{t().endedEarly}</p>{/if}
	</section>

	<StandingsTable
		rows={s.standings}
		meId={s.me.id}
		winnerIds={winners}
		caption={t().finalStandings}
		teams={s.teamStandings}
		myTeam={s.me.team}
		{winnerTeams}
	/>

	<p class="muted thanks">{t().thanksForPlaying}</p>
</Shell>

{#if confetti.length}
	<div class="confetti" aria-hidden="true">
		{#each confetti as c, i (i)}
			<span
				style:left="{c.left}%"
				style:background={c.color}
				style:animation-delay="{c.delay}s"
				style:animation-duration="{c.duration}s"
				style:--r="{c.rotate}deg"
			></span>
		{/each}
	</div>
{/if}

<style>
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		padding-top: clamp(var(--space-2), 4vh, var(--space-6));
	}
	.pins {
		display: flex;
		gap: var(--space-2);
		animation: drop 700ms var(--ease-out) both;
	}
	@keyframes drop {
		from {
			transform: translateY(-1.5rem);
			opacity: 0;
		}
	}
	h1 {
		font-size: clamp(1.9rem, 9.5vw, 2.75rem);
		letter-spacing: -0.02em;
		text-wrap: balance;
		overflow-wrap: anywhere;
	}
	.nobody h1 {
		font-size: clamp(1.6rem, 7.5vw, 2.1rem);
	}
	.place {
		padding: 0.3em 1em;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
	}
	.small {
		font-size: var(--text-sm);
	}
	.thanks {
		text-align: center;
		font-size: var(--text-sm);
	}
	.confetti {
		position: fixed;
		inset: 0;
		z-index: 40;
		pointer-events: none;
		overflow: hidden;
	}
	.confetti span {
		position: absolute;
		top: -2rem;
		width: 0.55rem;
		height: 0.9rem;
		border-radius: 2px;
		opacity: 0.9;
		animation-name: fall;
		animation-timing-function: cubic-bezier(0.3, 0.2, 0.6, 1);
		animation-fill-mode: forwards;
		animation-iteration-count: 2;
	}
	@keyframes fall {
		from {
			transform: translateY(0) rotate(var(--r));
		}
		to {
			transform: translateY(110dvh) rotate(calc(var(--r) + 540deg));
		}
	}
</style>
