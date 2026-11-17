<!--
  Between rounds: the scoreboard with movement caused by the round just revealed, a recap of
  that round, what happens next (round N, sudden death between named players, or the final
  result) and a small QR so latecomers can join before the next round.
-->
<script lang="ts">
	import QrCode from '#lib/ui/QrCode.svelte';
	import type { StandingsState, TvSnapshot } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import { gameTeamName, gameTeamNames } from '#lib/game/teams.ts';
	import Avatar from './Avatar.svelte';
	import JoinBug from './JoinBug.svelte';
	import StandingsTable from './StandingsTable.svelte';
	import { movementFor } from './tv.svelte.ts';

	let { snap }: { snap: TvSnapshot & StandingsState } = $props();
	const t = useT(tvDict);
	const tc = useT(common);
	const locale = useLocale();

	const result = $derived(snap.result);
	const next = $derived(snap.next);
	const movement = $derived(movementFor(snap.standings, result));
	const byId = $derived(new Map(snap.players.map((p) => [p.id, p])));
	const roundWinners = $derived(result.winnerPlayerIds.map((id) => byId.get(id)).filter((p) => !!p));
	const winKm = $derived(result.guesses.find((g) => g.isWinner)?.distanceKm ?? null);
	const place = $derived(localized(result.target, 'name', locale()));
	const after = $derived(
		result.round.isSuddenDeath
			? t().afterSuddenDeath(result.round.number)
			: t().afterRound(result.round.number, snap.game.totalRounds)
	);
	// Columns: as many as the row count wants, but never narrower than ~22rem each.
	let boardW = $state(0);
	let rem = $state(16);
	$effect(() => {
		rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
	});
	const n = $derived(snap.standings.length);
	const wantCols = $derived(n <= 9 ? 1 : n <= 18 ? 2 : 3);
	const maxCols = $derived(boardW ? Math.max(1, Math.floor(boardW / (22 * rem))) : wantCols);
	const cols = $derived(Math.min(wantCols, maxCols));
	const tableSize = $derived<'xl' | 'lg' | 'md' | 'sm' | undefined>(
		cols < wantCols ? (Math.ceil(n / cols) > 12 ? (Math.ceil(n / cols) > 18 ? 'sm' : 'md') : 'lg') : undefined
	);
	const duelTeams = $derived(next.kind === 'suddenDeath' ? next.teams : undefined);
	const duel = $derived(
		next.kind === 'suddenDeath' ? next.eligiblePlayerIds.map((id) => byId.get(id)).filter((p) => !!p) : []
	);
</script>

<section class={['standings', { sd: next.kind === 'suddenDeath', wide: snap.standings.length > 18 }]} data-testid="standings-screen" data-next={next.kind}>
	<header class="head">
		<div class="bug-slot"><JoinBug game={snap.game} /></div>
		<div class="title">
			<p class="eyebrow">{after}</p>
			<h1>{next.kind === 'suddenDeath' ? t().tiedAtTop : t().standings}</h1>
		</div>
		<div></div>
	</header>

	<div class="body">
		<div class="board" bind:clientWidth={boardW}>
			<StandingsTable
				rows={snap.standings}
				{movement}
				highlight={result.winnerPlayerIds}
				columns={cols}
				size={tableSize}
				teams={snap.teamStandings}
				highlightTeams={result.winnerTeams}
			/>
		</div>

		<aside class="side">
			<div class="card recap">
				<p class="c-eyebrow">{t().lastRound}</p>
				<p class="c-place">{place}</p>
				{#if roundWinners.length}
					<p class="c-line">
						{t().wonBy}
						{#each roundWinners as w, i (w.id)}
							{#if i > 0}<span class="amp">&amp;</span>{/if}
							<span class="who"><Avatar nickname={w.nickname} color={w.color} size="1.2em" />{w.nickname}</span>
						{/each}
						{#if winKm !== null}<span class="km">· {tc().km(winKm)}</span>{/if}
					</p>
					{#if result.winnerTeams?.length}
						<p class="c-line c-team" data-testid="recap-team">
							{tc().teamTookRound(gameTeamNames(snap.game, result.winnerTeams, locale()))}
						</p>
					{/if}
				{:else}
					<p class="c-line muted">{t().nobodyGuessed}</p>
				{/if}
			</div>

			<div class={['card', 'next', next.kind]} data-testid="next-step">
				{#if next.kind === 'round'}
					<p class="c-eyebrow">{t().upNext}</p>
					<p class="n-big">
						{tc().round} <b>{next.number}</b><span class="of">&thinsp;/&thinsp;{snap.game.totalRounds}</span>
					</p>
				{:else if next.kind === 'suddenDeath'}
					<p class="c-eyebrow sd-eyebrow">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z" /></svg>
						{t().upNext}
					</p>
					<p class="n-big">{t().suddenDeath}</p>
					{#if duelTeams}
						<p class="duel" data-testid="next-duel" data-teams={duelTeams.join(',')}>
							{#each duelTeams as team, i (team)}
								{#if i > 0}<span class="vs">{t().versus}</span>{/if}
								<span class="who">{gameTeamName(snap.game, team, locale())}</span>
							{/each}
						</p>
						<p class="hint">{t().duelHintTeams}</p>
					{:else}
						<p class="duel" data-testid="next-duel">
							{#each duel as p, i (p.id)}
								{#if i > 0}<span class="vs">{t().versus}</span>{/if}
								<span class="who"><Avatar nickname={p.nickname} color={p.color} size="1.25em" ring />{p.nickname}</span>
							{/each}
						</p>
						<p class="hint">{t().duelHint}</p>
					{/if}
				{:else}
					<p class="c-eyebrow">{t().upNext}</p>
					<p class="n-big trophy">
						<svg viewBox="0 0 24 24" aria-hidden="true"
							><path
								d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z"
							/></svg
						>
						{t().finalResult}
					</p>
				{/if}
			</div>

			{#if next.kind !== 'finish'}
				<div class="card join">
					<div class="qr"><QrCode value={snap.game.joinUrl} label={t().scanToJoin} quietZone={2} /></div>
					<div class="j-text">
						<p class="j-title">{t().joinNextRound}</p>
						<p class="j-code">{snap.game.joinCode}</p>
					</div>
				</div>
			{/if}
		</aside>
	</div>
</section>

<style>
	.standings {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr);
		gap: 2.4vh;
		padding: 2.6vh 2.4vw 3vh;
	}
	.head {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: start;
		gap: 2vw;
	}
	.bug-slot {
		justify-self: start;
	}
	.title {
		text-align: center;
		animation: drop 700ms var(--ease-out) both;
	}
	.eyebrow {
		font-size: 1rem;
		font-weight: 800;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--tv-gold);
	}
	h1 {
		font-size: clamp(2.2rem, 8vh, 3.6rem);
		font-weight: 900;
		letter-spacing: -0.03em;
	}
	.sd h1 {
		color: #ff8a95;
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) min(23rem, 30vw);
		gap: 2.4vw;
		min-height: 0;
	}
	.board {
		min-height: 0;
		overflow: hidden;
		padding: 1.2rem 1.4rem;
		border-radius: 1.5rem;
		background: rgb(255 255 255 / 0.035);
		border: 1px solid var(--tv-line);
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		min-height: 0;
	}
	.card {
		padding: 1rem 1.2rem;
		border-radius: 1.3rem;
		background: var(--tv-glass);
		border: 1px solid var(--tv-line);
		animation: in-right 700ms var(--ease-out) both;
	}
	.card:nth-child(2) {
		animation-delay: 150ms;
	}
	.card:nth-child(3) {
		animation-delay: 300ms;
	}
	.c-eyebrow {
		font-size: 0.82rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--tv-ink-3);
	}
	.c-place {
		margin-top: 0.2rem;
		font-size: 1.5rem;
		font-weight: 850;
		line-height: 1.15;
		letter-spacing: -0.015em;
	}
	.c-line {
		margin-top: 0.4rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		font-size: 1.05rem;
		color: var(--tv-ink-2);
	}
	.c-line.c-team {
		color: var(--tv-gold);
		font-weight: 800;
	}
	.c-line.muted {
		color: var(--tv-ink-3);
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		font-weight: 800;
		color: var(--tv-ink);
	}
	.amp,
	.km {
		color: var(--tv-ink-3);
	}
	.km {
		font-variant-numeric: tabular-nums;
	}

	.next {
		padding: 1.2rem 1.3rem;
	}
	.next.round {
		background: linear-gradient(135deg, rgb(255 194 61 / 0.2), rgb(255 159 28 / 0.06));
		border-color: rgb(255 194 61 / 0.45);
	}
	.next.suddenDeath {
		background: linear-gradient(135deg, rgb(255 77 94 / 0.35), rgb(120 10 40 / 0.25));
		border-color: rgb(255 77 94 / 0.7);
		box-shadow: 0 0 2.4rem rgb(255 50 70 / 0.25);
	}
	.next.finish {
		background: linear-gradient(135deg, rgb(255 194 61 / 0.3), rgb(255 120 40 / 0.12));
		border-color: rgb(255 194 61 / 0.7);
	}
	.next .c-eyebrow {
		color: var(--tv-gold);
	}
	.n-big {
		margin-top: 0.15rem;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.n-big b {
		font-size: 1.3em;
	}
	.of {
		color: var(--tv-ink-3);
		font-weight: 800;
	}
	.trophy {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.6rem;
	}
	.trophy svg {
		width: 2.2rem;
		height: 2.2rem;
		fill: var(--tv-gold);
		flex: none;
	}
	.sd-eyebrow {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: #ffd0d5 !important;
	}
	.sd-eyebrow svg {
		width: 1.1em;
		height: 1.1em;
		fill: currentColor;
	}
	.duel {
		margin-top: 0.6rem;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.7rem;
		font-size: 1.3rem;
	}
	.vs {
		font-size: 0.75em;
		font-weight: 800;
		text-transform: uppercase;
		color: #ffb3bb;
	}
	.hint {
		margin-top: 0.6rem;
		font-size: 0.9rem;
		color: #ffd0d5;
		line-height: 1.35;
	}

	.join {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: auto;
	}
	.qr {
		width: min(7.5rem, 16vh);
		flex: none;
		border-radius: 0.6rem;
		overflow: hidden;
	}
	.j-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--tv-ink-2);
		line-height: 1.25;
	}
	.j-code {
		margin-top: 0.3rem;
		font-size: 2rem;
		font-weight: 900;
		letter-spacing: 0.1em;
		color: var(--tv-gold);
	}
	/* Big rooms: the board takes the full width, the cards line up underneath. */
	.wide .body {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 1.8vh;
	}
	.wide .side {
		flex-direction: row;
		align-items: stretch;
	}
	.wide .card {
		flex: 1 1 0;
		min-width: 0;
	}
	.wide .join {
		margin-top: 0;
		flex: 0 1 auto;
	}
	.wide .qr {
		width: min(5.5rem, 11vh);
	}
	.wide .n-big {
		font-size: 1.6rem;
	}
	.wide .hint {
		display: none;
	}
	.wide .board {
		padding: 0.9rem 1.2rem;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-1rem);
		}
	}
	@keyframes in-right {
		from {
			opacity: 0;
			transform: translateX(2rem);
		}
	}
</style>
