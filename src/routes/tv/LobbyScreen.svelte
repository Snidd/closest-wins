<!--
  Lobby: the join QR (black on white, big enough to scan from the sofa), the code and short URL
  for those who type, the playlist, and players popping in live (fits 40). In a teams game the
  players appear under their team's heading (every team, empty ones included).
-->
<script lang="ts">
	import QrCode from '#lib/ui/QrCode.svelte';
	import { MAX_PLAYERS, type TvSnapshot } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import { teamName } from '#lib/game/teams.ts';
	import Avatar from './Avatar.svelte';
	import Logo from './Logo.svelte';
	import { shortJoinUrl } from './tv.svelte.ts';

	let { snap }: { snap: TvSnapshot } = $props();
	const t = useT(tvDict);
	const tc = useT(common);
	const locale = useLocale();

	const players = $derived(snap.players);
	const n = $derived(players.length);
	const tier = $derived(n <= 8 ? 'xl' : n <= 15 ? 'lg' : n <= 24 ? 'md' : 'sm');
	const playlistName = $derived(localized(snap.game.playlistName, 'name', locale()));
</script>

<section class="lobby" data-testid="lobby-screen">
	<aside class="join">
		<div class="qr-card">
			<QrCode value={snap.game.joinUrl} label={t().scanToJoin} size="100%" quietZone={2} class="qr" />
		</div>
		<p class="scan">{t().scanToJoin}</p>
		<p class="type">
			{t().orGoTo} <b class="url">{shortJoinUrl(snap.game.joinUrl)}</b>
			{t().andEnter}
		</p>
		<p class="code u-code" data-testid="join-code" aria-label="{t().joinCode} {snap.game.joinCode}">
			{#each snap.game.joinCode.split('') as ch, i (i)}<span>{ch}</span>{/each}
		</p>
	</aside>

	<div class="main">
		<header class="head">
			<Logo class="lobby-logo" />
			{#if playlistName}
				<div class="playlist">
					<span class="eyebrow">{t().playlist}</span>
					<h1 class="pl-name">{playlistName}</h1>
					<span class="meta">{t().roundsAndTimer(snap.game.totalRounds, snap.game.timerSeconds)}</span>
				</div>
			{/if}
		</header>

		<div class="roster">
			<div class="count">
				<span class="num" data-testid="player-count">{n}</span>
				<span class="lbl">{tc().players}</span>
				<span class="max">/ {MAX_PLAYERS}</span>
			</div>
			{#if snap.game.teams}
				<div class="teams" data-testid="lobby-teams">
					{#each snap.game.teams as team (team.index)}
						{@const members = players.filter((p) => p.team === team.index)}
						<section class="team" data-testid="lobby-team" data-team={team.index}>
							<h2 class="team-name" data-testid="team-heading">
								{teamName(team.index, team.name, locale())}
								<span class="team-count">{members.length}</span>
							</h2>
							<ul class={['players', 'in-team', tier]}>
								{#each members as p (p.id)}
									<li
										class={['player', { offline: !p.connected }]}
										data-testid="lobby-player"
										data-player-id={p.id}
										data-team={p.team}
									>
										<Avatar nickname={p.nickname} color={p.color} size="1.7em" offline={!p.connected} />
										<span class="name">{p.nickname}</span>
									</li>
								{/each}
							</ul>
						</section>
					{/each}
				</div>
			{:else if n === 0}
				<p class="empty">{t().waitingForPlayers}</p>
			{:else}
				<ul class={['players', tier]} data-testid="lobby-players">
					{#each players as p (p.id)}
						<li class={['player', { offline: !p.connected }]} data-testid="lobby-player" data-player-id={p.id}>
							<Avatar nickname={p.nickname} color={p.color} size="1.7em" offline={!p.connected} />
							<span class="name">{p.nickname}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<p class="waiting">
			<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
			{t().waitingForHost}
		</p>
	</div>
</section>

<style>
	.lobby {
		position: absolute;
		inset: 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		gap: 4vw;
		padding: 5vh 4vw;
	}

	/* --- Join column --------------------------------------------------------------------- */
	.join {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.6vh;
		/* The QR is the largest square that leaves room for the lines below it. */
		--qr: min(60vh, 36vw);
		width: calc(var(--qr) + 3vh);
		animation: in-left 800ms var(--ease-out) both;
	}
	.qr-card {
		width: calc(var(--qr) + 3vh);
		padding: 1.5vh;
		border-radius: 1.6vh;
		background: #ffffff;
		box-shadow:
			0 0 0 0.35vh rgb(255 194 61 / 0.9),
			0 2vh 5vh rgb(0 0 0 / 0.5);
	}
	.join :global(.qr) {
		width: 100%;
		height: auto;
	}
	.scan {
		margin-top: 1vh;
		font-size: 1.9rem;
		font-weight: 850;
		letter-spacing: -0.01em;
		color: var(--tv-ink);
	}
	.type {
		font-size: 1.1rem;
		color: var(--tv-ink-2);
		text-align: center;
	}
	.url {
		color: var(--tv-ink);
		font-weight: 750;
		white-space: nowrap;
	}
	.code {
		display: flex;
		gap: 0.6vw;
	}
	.code span {
		display: grid;
		place-items: center;
		width: 1.15em;
		height: 1.3em;
		border-radius: 0.18em;
		background: var(--tv-gold);
		color: var(--color-accent-contrast);
		font-size: min(3.4rem, 8vh);
		font-weight: 900;
		line-height: 1;
		box-shadow: 0 0.08em 0.2em rgb(0 0 0 / 0.45);
	}

	/* --- Main column ---------------------------------------------------------------------- */
	.main {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 3vh;
		min-width: 0;
		animation: in-right 800ms 120ms var(--ease-out) both;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 2.2vh;
	}
	.head :global(.lobby-logo) {
		font-size: 1.6rem;
		color: var(--tv-ink-2);
	}
	.playlist {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.eyebrow {
		font-size: 0.9rem;
		font-weight: 800;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: var(--tv-gold);
	}
	.pl-name {
		font-size: clamp(2rem, 7vh, 3.6rem);
		font-weight: 850;
		letter-spacing: -0.025em;
		line-height: 1.05;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		text-wrap: balance;
	}
	.meta {
		font-size: 1.15rem;
		color: var(--tv-ink-2);
		font-weight: 550;
	}

	.roster {
		display: flex;
		flex-direction: column;
		gap: 2vh;
		min-height: 0;
		overflow: hidden;
		padding: 2.4vh 2vw;
		border-radius: 1.4rem;
		background: rgb(255 255 255 / 0.045);
		border: 1px solid var(--tv-line);
	}
	.count {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
	}
	.max {
		font-size: 1rem;
		font-weight: 700;
		color: var(--tv-ink-3);
		font-variant-numeric: tabular-nums;
	}
	.num {
		font-size: clamp(2.4rem, 8vh, 4rem);
		font-weight: 900;
		line-height: 1;
		font-variant-numeric: tabular-nums;
		background: linear-gradient(180deg, #fff, #9fb4d6);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.lbl {
		font-size: 0.95rem;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--tv-ink-2);
	}
	.empty {
		font-size: 1.5rem;
		color: var(--tv-ink-3);
		font-weight: 550;
	}
	.players {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: var(--gap);
		grid-template-columns: repeat(auto-fill, minmax(var(--col), 1fr));
		align-content: start;
		min-height: 0;
	}
	.players.xl {
		--col: 13rem;
		--gap: 1.1rem 1.2rem;
		font-size: 1.5rem;
	}
	.players.lg {
		--col: 10.5rem;
		--gap: 0.9rem 1rem;
		font-size: 1.2rem;
	}
	.players.md {
		--col: 9rem;
		--gap: 0.7rem 0.8rem;
		font-size: 1rem;
	}
	.players.sm {
		--col: 7.4rem;
		--gap: 0.4rem 0.5rem;
		font-size: 0.82rem;
	}
	.player {
		display: flex;
		align-items: center;
		gap: 0.45em;
		min-width: 0;
		padding: 0.25em 0.7em 0.25em 0.3em;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.07);
		animation: pop 600ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	.name {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.offline .name {
		color: var(--tv-ink-3);
	}

	.teams {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
		gap: 1.6vh 1.6vw;
		align-content: start;
		min-height: 0;
	}
	.team {
		display: flex;
		flex-direction: column;
		gap: 1vh;
		min-width: 0;
		padding: 1.4vh 1vw;
		border-radius: 1rem;
		background: rgb(255 255 255 / 0.05);
	}
	.team-name {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-size: 1.5rem;
		font-weight: 850;
		letter-spacing: -0.01em;
		overflow-wrap: anywhere;
	}
	.team-count {
		font-size: 1rem;
		font-weight: 700;
		color: var(--tv-ink-3);
		font-variant-numeric: tabular-nums;
	}
	.players.in-team {
		--col: 100%;
		font-size: min(1em, 1.2rem);
	}

	.waiting {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		font-size: 1.35rem;
		font-weight: 650;
		color: var(--tv-ink-2);
	}
	.dots {
		display: inline-flex;
		gap: 0.3rem;
	}
	.dots i {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--tv-gold);
		animation: bounce 1.2s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.15s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.3s;
	}

	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0.4);
		}
	}
	@keyframes bounce {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.5;
		}
		30% {
			transform: translateY(-0.4rem);
			opacity: 1;
		}
	}
	@keyframes in-left {
		from {
			opacity: 0;
			transform: translateX(-3vw);
		}
	}
	@keyframes in-right {
		from {
			opacity: 0;
			transform: translateX(3vw);
		}
	}
</style>
