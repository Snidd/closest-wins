<!--
  The round's result in the host's language: the place, its fact, who won and everyone's
  distance, plus whether the TV is still playing its reveal animation.
-->
<script lang="ts">
	import { localized, type Locale } from '#lib/i18n/index.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import { gameTeamName } from '#lib/game/teams.ts';
	import { listNames, playerLookup, type HostPhase } from './types.ts';

	type Props = { snap: HostPhase<'reveal'>; locale: Locale; revealDone: boolean; progress: number };
	let { snap, locale, revealDone, progress }: Props = $props();

	const t = useT(host);
	const c = useT(common);

	const result = $derived(snap.result);
	const who = $derived(playerLookup(snap.players, snap.standings));
	const place = $derived(localized(result.target, 'name', locale));
	const fact = $derived(localized(result.target, 'fact', locale));
	/** The clue photo's credit (only sent with the answer: it can name the place). */
	const credit = $derived(result.round.clue.photo);
	const winnerNames = $derived(result.winnerPlayerIds.map((id) => who(id).nickname));
	const best = $derived(result.guesses.find((g) => g.isWinner));
	const winnerTeams = $derived(
		result.winnerTeams?.length ? listNames(result.winnerTeams.map((i) => gameTeamName(snap.game, i, locale)), locale) : ''
	);
</script>

<section class={['tv-progress', { done: revealDone }]} aria-live="polite" data-testid="reveal-progress">
	<span class="tv-label">{revealDone ? t().tvRevealDone : t().tvRevealing}</span>
	<span class="bar" aria-hidden="true"><span style:transform="scaleX({revealDone ? 1 : progress})"></span></span>
</section>

<section class="answer" aria-labelledby="answer-title">
	<h2 id="answer-title" class="eyebrow">{t().answer}</h2>
	<p class="place" data-testid="reveal-place">{place}</p>
	{#if fact}<p class="fact">{fact}</p>{/if}
	{#if credit && (credit.attribution || credit.sourceUrl)}
		<p class="credit" data-testid="reveal-credit">
			{#if credit.sourceUrl}
				<a href={credit.sourceUrl} target="_blank" rel="noopener noreferrer nofollow"
					>{credit.attribution ? t().photoBy(credit.attribution) : t().photoSource}</a
				>
			{:else}
				{t().photoBy(credit.attribution!)}
			{/if}
		</p>
	{/if}
</section>

<section class="winner" data-testid="round-winner" data-winner-teams={result.winnerTeams?.join(',')}>
	{#if winnerNames.length === 0}
		<p class="w-text muted">{t().nobodyGuessed}</p>
	{:else}
		<span class="trophy" aria-hidden="true">🏆</span>
		<p class="w-text">
			{winnerNames.length === 1 ? t().roundWinner(winnerNames[0]!) : t().roundTie(listNames(winnerNames, locale))}
			{#if best}<span class="w-km">{c().km(best.distanceKm)}</span>{/if}
			{#if winnerTeams}<span class="w-team" data-testid="round-winner-teams">{c().teamTookRound(winnerTeams)}</span>{/if}
		</p>
	{/if}
</section>

<section class="card" aria-labelledby="results-title">
	<h2 id="results-title" class="eyebrow">{t().results}</h2>
	<ol class="results">
		{#each result.guesses as g (g.playerId)}
			{@const p = who(g.playerId)}
			<li class={{ win: g.isWinner }} data-testid="result-row">
				<span class="rank">{g.rank}</span>
				<span class="dot" style:background={p.color} aria-hidden="true"></span>
				<span class="name">
					{p.nickname}
					{#if !g.locked}<span class="note">{t().timeRanOut}</span>{/if}
				</span>
				<span class="km">{c().km(g.distanceKm)}</span>
			</li>
		{/each}
		{#each result.noGuessPlayerIds as id (id)}
			{@const p = who(id)}
			<li class="none" data-testid="result-row">
				<span class="rank">–</span>
				<span class="dot" style:background={p.color} aria-hidden="true"></span>
				<span class="name">{p.nickname}</span>
				<span class="km">{t().noGuess}</span>
			</li>
		{/each}
	</ol>
</section>

<style>
	.tv-progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.tv-label {
		font-weight: var(--weight-medium);
	}
	.bar {
		height: 0.3rem;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transform-origin: left;
		transition: transform 0.25s linear;
	}
	.done .bar span {
		background: var(--color-success);
	}
	.answer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5) var(--space-4);
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
	.place {
		font-size: var(--text-3xl);
		font-weight: var(--weight-bold);
		line-height: var(--leading-tight);
		text-wrap: balance;
	}
	.fact {
		color: var(--color-text-muted);
		text-wrap: pretty;
	}
	.credit {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}
	.credit a {
		color: inherit;
	}
	.winner {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		background: color-mix(in oklab, var(--color-accent) 12%, var(--color-surface));
		border: 2px solid color-mix(in oklab, var(--color-accent) 70%, transparent);
	}
	.trophy {
		font-size: var(--text-2xl);
	}
	.w-text {
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		line-height: var(--leading-tight);
	}
	.w-km {
		display: block;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}
	.w-team {
		display: block;
		font-size: var(--text-md);
		font-weight: var(--weight-bold);
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
	.results {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.results li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 2.75rem;
		border-top: 1px solid var(--color-border);
	}
	.results li:first-child {
		border-top: 0;
	}
	.rank {
		flex: none;
		width: 1.5rem;
		text-align: center;
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.win .rank {
		color: var(--color-accent);
	}
	.dot {
		flex: none;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
	}
	.name {
		flex: 1;
		min-width: 0;
		font-weight: var(--weight-bold);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.note {
		margin-left: 0.4em;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
	}
	.km {
		flex: none;
		font-variant-numeric: tabular-nums;
		font-weight: var(--weight-medium);
	}
	.none .name,
	.none .km {
		color: var(--color-text-muted);
		font-weight: var(--weight-normal);
	}
</style>
