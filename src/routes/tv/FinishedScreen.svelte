<!--
  Game over: the winner celebration (single, shared or nobody), the final table, and the next
  pairing code tucked in a corner so the host can pair this screen with their next game.
  In a teams game the winning team(s) are named, with their members on the podium.
-->
<script lang="ts">
	import type { FinishedState, TvSnapshot } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { gameTeamNames } from '#lib/game/teams.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import Avatar from './Avatar.svelte';
	import Confetti from './Confetti.svelte';
	import Logo from './Logo.svelte';
	import StandingsTable from './StandingsTable.svelte';

	let { snap, host }: { snap: TvSnapshot & FinishedState; host: string } = $props();
	const t = useT(tvDict);
	const tc = useT(common);
	const locale = useLocale();

	const rowsById = $derived(new Map(snap.standings.map((r) => [r.playerId, r])));
	const winners = $derived(snap.winnerPlayerIds.map((id) => rowsById.get(id)).filter((r) => !!r));
	/** Teams game: the winning teams decide single / shared / none; the podium shows their members. */
	const winnerTeams = $derived(snap.winnerTeams);
	const teamRow = $derived(snap.teamStandings?.find((r) => r.team === winnerTeams?.[0]));
	const kind = $derived.by(() => {
		const n = winnerTeams ? (winners.length ? winnerTeams.length : 0) : winners.length;
		return n === 0 ? 'none' : n === 1 ? 'single' : 'shared';
	});
	const confettiColors = $derived(
		winners.length ? [...winners.map((w) => w.color), '#ffc23d', '#ffffff'] : []
	);
	const code = $derived(snap.nextPairing?.pairingCode ?? null);
	const nameSize = $derived.by(() => {
		const longest = Math.max(0, ...winners.map((w) => w.nickname.length));
		if (winnerTeams) return winners.length <= 2 ? 2.6 : winners.length <= 4 ? 2 : 1.5;
		if (kind === 'single') return longest <= 8 ? 6 : longest <= 12 ? 4.8 : 3.8;
		return longest <= 8 ? 3 : 2.4;
	});
</script>

<section
	class={['finished', kind, { teams: !!winnerTeams }]}
	data-testid="finished-screen"
	data-winners={snap.winnerPlayerIds.join(',')}
	data-winner-teams={winnerTeams?.join(',')}
>
	{#if kind !== 'none'}<Confetti colors={confettiColors} />{/if}

	<div class="hero" data-testid="game-winner">
		<p class="eyebrow">{tc().finished}</p>
		{#if kind === 'none'}
			<div class="empty-cup" aria-hidden="true">
				<svg viewBox="0 0 24 24"
					><path
						d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3zm0 4H6v1a2 2 0 0 0 1 1.7zm10 0v2.7A2 2 0 0 0 18 8V7z"
					/></svg
				>
			</div>
			<h1 class="headline">{t().noWinner}</h1>
			<p class="sub">{t().noWinnerHint}</p>
		{:else}
			{#if winnerTeams}
				<p class="team-champ" data-testid="winner-team">{gameTeamNames(snap.game, winnerTeams, locale())}</p>
			{/if}
			<div class="podium">
				{#each winners as w, i (w.playerId)}
					<div class="champ" style:--c={w.color} style:--i={i}>
						<span class="halo" aria-hidden="true"></span>
						<svg class="crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16h20l1-11-6 4-5-8-5 8-6-4z" /></svg>
						<Avatar
							nickname={w.nickname}
							color={w.color}
							size={winnerTeams ? 'min(5rem, 11vh)' : kind === 'single' ? 'min(11rem, 24vh)' : 'min(7rem, 16vh)'}
							ring
						/>
						<span class="champ-name" style:font-size="{nameSize}rem">{w.nickname}</span>
					</div>
				{/each}
			</div>
			<h1 class="headline">{kind === 'single' ? t().winsGame : t().sharedVictory}</h1>
			<p class="sub stats">
				{t().roundsWon(teamRow?.roundsWon ?? winners[0]!.roundsWon)}
				{#if kind === 'single' && !winnerTeams && winners[0]!.guessedRounds}
					· {t().totalKm(tc().km(winners[0]!.totalDistanceKm))}
				{/if}
			</p>
		{/if}
		{#if snap.endedEarly}<p class="early">{t().endedEarly}</p>{/if}
	</div>

	<aside class="final">
		<p class="f-title">{t().finalStandings}</p>
		<StandingsTable
			rows={snap.standings}
			highlight={snap.winnerPlayerIds}
			max={snap.standings.length > 9 ? 8 : 9}
			columns={snap.teamStandings ? 2 : 1}
			size={snap.standings.length <= 6 ? 'lg' : 'md'}
			teams={snap.teamStandings}
			highlightTeams={winnerTeams}
		/>
	</aside>

	<footer class="corner">
		<Logo class="corner-logo" />
		{#if code}
			<p class="next" data-testid="next-pairing" data-code={code}>
				{t().nextGame}
				<b class="pcode">{code.slice(0, 3)} {code.slice(3)}</b>
				<span class="at">· {host}/host</span>
			</p>
		{/if}
	</footer>
</section>

<style>
	.finished {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 2vh 3vw;
		padding: 4vh 3vw 3vh;
	}
	.finished {
		isolation: isolate;
	}
	.finished > :global(.confetti) {
		z-index: -1;
	}
	.hero,
	.final,
	.corner {
		position: relative;
		z-index: 2;
	}
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 1vh;
		min-height: 0;
	}
	.eyebrow {
		font-size: 1.05rem;
		font-weight: 800;
		letter-spacing: 0.24em;
		text-transform: uppercase;
		color: var(--tv-gold);
		animation: rise 700ms var(--ease-out) both;
	}
	.podium {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		gap: 3vw;
		margin: 9vh 0 1vh;
	}
	.team-champ {
		margin-top: 6vh;
		font-size: clamp(2.6rem, 10vh, 5.2rem);
		font-weight: 900;
		letter-spacing: -0.03em;
		line-height: 1.05;
		color: var(--tv-gold);
		overflow-wrap: anywhere;
		text-wrap: balance;
		animation: rise 800ms 200ms var(--ease-out) both;
	}
	.teams .podium {
		flex-wrap: wrap;
		gap: 1.5vh 2vw;
		margin-top: 7vh;
	}
	.champ {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.6vh;
		animation: champ-in 1s calc(300ms + var(--i) * 200ms) cubic-bezier(0.3, 1.5, 0.5, 1) both;
	}
	.halo {
		position: absolute;
		top: -20%;
		left: 50%;
		width: 170%;
		aspect-ratio: 1;
		transform: translateX(-50%);
		border-radius: 50%;
		background: radial-gradient(circle, color-mix(in srgb, var(--c) 45%, transparent) 0%, transparent 65%);
		filter: blur(10px);
		z-index: -1;
		animation: halo 3s ease-in-out infinite alternate;
	}
	.crown {
		position: absolute;
		top: calc(-1 * min(3.4rem, 7vh));
		width: min(5rem, 10vh);
		height: auto;
		fill: var(--tv-gold);
		filter: drop-shadow(0 0.3rem 0.6rem rgb(0 0 0 / 0.5));
		z-index: 2;
		animation: crown-drop 900ms calc(900ms + var(--i) * 200ms) cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	.shared .crown {
		top: calc(-1 * min(2.4rem, 5vh));
		width: min(3.4rem, 7vh);
	}
	/* Team members are smaller than a lone champion: so are their crowns. */
	.teams .crown {
		top: calc(-1 * min(2rem, 4.2vh));
		width: min(3rem, 6vh);
	}
	.champ-name {
		font-weight: 900;
		letter-spacing: -0.035em;
		line-height: 1;
		color: color-mix(in srgb, var(--c) 55%, white);
		text-shadow: 0 0.3rem 2rem rgb(0 0 0 / 0.5);
		max-width: 40vw;
		overflow-wrap: anywhere;
	}
	.headline {
		font-size: clamp(2rem, 7vh, 3.4rem);
		font-weight: 900;
		letter-spacing: -0.025em;
		animation: rise 800ms 1.1s var(--ease-out) both;
	}
	.none .headline {
		animation-delay: 200ms;
	}
	.sub {
		font-size: 1.35rem;
		font-weight: 600;
		color: var(--tv-ink-2);
		animation: rise 800ms 1.3s var(--ease-out) both;
	}
	.none .sub {
		animation-delay: 350ms;
	}
	.stats {
		font-variant-numeric: tabular-nums;
	}
	.early {
		margin-top: 1vh;
		padding: 0.3rem 0.9rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.08);
		font-size: 0.95rem;
		color: var(--tv-ink-2);
	}
	.empty-cup svg {
		width: min(9rem, 20vh);
		height: min(9rem, 20vh);
		fill: none;
		stroke: var(--tv-ink-3);
		stroke-width: 1;
		margin: 2vh 0;
	}

	.final {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 0;
		overflow: hidden;
		align-self: center;
		max-height: 100%;
		padding: 1.4rem 1.5rem;
		border-radius: 1.5rem;
		background: rgb(10 20 42 / 0.94);
		border: 1px solid var(--tv-line);
		animation: in-right 900ms 600ms var(--ease-out) both;
	}
	.final :global(.table) {
		flex: none;
	}
	.f-title {
		font-size: 0.9rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--tv-ink-3);
	}

	.corner {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2vw;
	}
	.corner :global(.corner-logo) {
		font-size: 1.3rem;
		color: var(--tv-ink-2);
	}
	.next {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem 0.45rem 1rem;
		border-radius: 1rem;
		background: var(--tv-glass);
		border: 1px solid var(--tv-line);
		font-size: 0.95rem;
		color: var(--tv-ink-2);
	}
	.pcode {
		padding: 0.1rem 0.6rem;
		border-radius: 0.6rem;
		background: rgb(255 255 255 / 0.1);
		color: var(--tv-ink);
		font-size: 1.4rem;
		font-weight: 850;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
	.at {
		color: var(--tv-ink-3);
	}

	@keyframes champ-in {
		from {
			opacity: 0;
			transform: translateY(6vh) scale(0.6);
		}
	}
	@keyframes crown-drop {
		from {
			opacity: 0;
			transform: translateY(-4vh) rotate(-20deg) scale(1.3);
		}
	}
	@keyframes halo {
		to {
			transform: translateX(-50%) scale(1.15);
			opacity: 0.7;
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(1.5rem);
		}
	}
	@keyframes in-right {
		from {
			opacity: 0;
			transform: translateX(3rem);
		}
	}
</style>
