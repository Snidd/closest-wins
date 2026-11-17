<!--
  The reveal: full-screen map running the server-timed choreography, with overlays that
  follow the same clock (so they keep going even if the map is slow or fails):

    pins    (revealStartedAt → answerVisibleAt)  suspense banner, no answer anywhere
    flying  (+2.8 s)                             "And the answer is…"
    lines   (+1.6 s)                             the camera has landed: place name, then fact
    done                                         winner(s) + ranked distances slide in

  A reload mid-reveal lands in the right stage; `skipped` goes straight to `done`.
  `padding` tells the camera which screen areas the overlays cover.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import RevealMap from '#lib/map/RevealMap.svelte';
	import { revealTimingAt, type RevealStage } from '#lib/map/reveal.ts';
	import type { PlayerSummary, RoundResult, StandingRow, GameInfo } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import { gameTeamNames } from '#lib/game/teams.ts';
	import Avatar from './Avatar.svelte';
	import JoinBug from './JoinBug.svelte';

	type Props = {
		game: GameInfo;
		players: PlayerSummary[];
		result: RoundResult;
		standings: StandingRow[];
		offsetMs: number;
		/** Standings phase: show the end state at once (map in final mode, no choreography). */
		final?: boolean;
	};
	let { game, players, result, offsetMs, final = false }: Props = $props();
	const t = useT(tvDict);
	const tc = useT(common);
	const locale = useLocale();

	// --- Clock-driven stage (independent of the map) -----------------------------------------
	let now = $state(untrack(() => Date.now() + offsetMs));
	const timing = $derived(final ? null : revealTimingAt(result, now));
	const stage = $derived<RevealStage>(timing?.stage ?? 'done');
	let mapStage = $state<RevealStage | null>(null);

	/** Moves the clock forward only: offset jitter between snapshots must not flip a stage back. */
	const advance = () => {
		const t = Date.now() + offsetMs;
		if (t > untrack(() => now)) now = t;
	};
	// Keyed on the stage boundary, not on the `timing` object (new with every snapshot). Checks
	// against the latest offset when it fires and waits again if the boundary is not reached yet;
	// once it is, the clock is moved to at least the boundary, so the stage always advances.
	const nextAt = $derived(timing?.endsAt ?? Infinity);
	$effect(() => {
		const endsAt = nextAt;
		if (endsAt === Infinity) return;
		let id: ReturnType<typeof setTimeout> | undefined;
		const check = () => {
			const t = Date.now() + untrack(() => offsetMs);
			if (t < endsAt) {
				id = setTimeout(check, endsAt - t + 30);
				return;
			}
			now = Math.max(untrack(() => now), t);
		};
		check();
		return () => clearTimeout(id);
	});
	$effect(() => {
		// Offset updates (new snapshot) re-anchor the clock.
		void offsetMs;
		advance();
	});

	const answerShown = $derived(stage === 'lines' || stage === 'done');
	const done = $derived(stage === 'done');
	/** Mounted after the choreography had finished (reload, standings): no long build-up. */
	const mountedDone = untrack(() => revealTimingAt(result, Date.now() + offsetMs).stage === 'done');
	const instant = $derived(final || result.skipped || mountedDone);

	// --- Data -----------------------------------------------------------------------------
	const byId = $derived(new Map(players.map((p) => [p.id, p])));
	const name = $derived(localized(result.target, 'name', locale()));
	const fact = $derived(localized(result.target, 'fact', locale()));
	/** The clue photo's credit: it can name the place, so it is shown with the answer only. */
	const credit = $derived(result.round.clue.photo?.attribution ?? null);
	const winners = $derived(result.winnerPlayerIds.map((id) => byId.get(id)).filter((p) => !!p));
	const winnerKm = $derived(result.guesses.find((g) => g.isWinner)?.distanceKm ?? null);
	const guessCount = $derived(result.guesses.length);
	/** Guesses on the map so far: they appear one by one. */
	let pinsShown = $state(0);
	/** Rows that fit the panel (measured); the rest become "+ N more". */
	let fit = $state(8);
	let rowsEl = $state<HTMLOListElement>();
	$effect(() => {
		const el = rowsEl;
		if (!el) return;
		const measure = () => {
			// Count the rows that are fully visible; the list clips the rest.
			const bottom = el.getBoundingClientRect().bottom + 1;
			let n = 0;
			for (const row of el.children) {
				if (row.getBoundingClientRect().bottom <= bottom) n++;
				else break;
			}
			if (n < el.children.length) fit = Math.max(1, n);
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});
	const listMax = $derived(Math.min(guessCount, fit));
	const listed = $derived(result.guesses.slice(0, listMax));
	const roundLabel = $derived(
		result.round.isSuddenDeath ? t().suddenDeath : tc().roundOf(result.round.number, game.totalRounds)
	);
	const factSize = $derived(fact.length <= 110 ? 1.45 : fact.length <= 220 ? 1.2 : fact.length <= 400 ? 1.02 : 0.9);
	const nameSize = $derived(name.length <= 18 ? 4 : name.length <= 30 ? 3.2 : 2.5);

	// --- Camera padding (px) matching the overlay layout below --------------------------------
	let vw = $state(1920);
	let vh = $state(1080);
	let rem = $state(27);
	$effect(() => {
		const measure = () => {
			vw = window.innerWidth;
			vh = window.innerHeight;
			rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		};
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});
	const panelW = $derived(Math.min(27 * rem, 0.34 * vw));
	const padding = $derived({
		top: Math.round(5.6 * rem),
		right: Math.round(panelW + 0.03 * vw),
		bottom: Math.round(Math.min(11.5 * rem, 0.34 * vh)),
		left: Math.round(0.02 * vw)
	});

	const suspenseMs = $derived(Math.max(1, result.answerVisibleAt - result.revealStartedAt));
	const suspenseElapsed = $derived(Math.max(0, Date.now() + offsetMs - result.revealStartedAt));
</script>

<section
	class={['reveal', `stage-${stage}`, { instant }]}
	data-testid="reveal-screen"
	data-reveal-stage={stage}
	data-map-stage={mapStage ?? ''}
	style:--panel-w="{panelW}px"
	style:--bottom-h="{padding.bottom}px"
>
	<div class="map">
		<RevealMap
			{players}
			{result}
			{offsetMs}
			mode={final ? 'final' : 'live'}
			theme="dark"
			{padding}
			attributionPosition="top-right"
			onstage={(s) => (mapStage = s)}
			bind:pinsShown
		/>
	</div>
	<div class="shade" aria-hidden="true"></div>

	<header class="top">
		<JoinBug {game} />
		<span class={['round-pill', { sd: result.round.isSuddenDeath }]}>{roundLabel}</span>
	</header>

	{#if !answerShown}
		<div class="suspense" data-testid="reveal-suspense">
			{#if stage === 'pins'}
				<p class="headline">{guessCount ? t().revealPins : t().noGuessesOnMap}</p>
				<p class="sub">{t().guessCount(pinsShown)}</p>
				<span class="drum" style:--d="{suspenseMs}ms" style:--e="{-suspenseElapsed}ms"><i></i></span>
			{:else}
				<p class="headline flying">
					{t().revealFlying.replace(/…$/, '')}<span class="ell"><i>.</i><i>.</i><i>.</i></span>
				</p>
			{/if}
		</div>
	{:else}
		<div class="answer" data-testid="reveal-answer">
			<h1 class="place" style:font-size="{nameSize}rem" data-testid="reveal-name">{name}</h1>
			{#if fact}
				<p class="fact" style:font-size="{factSize}rem" data-testid="reveal-fact">{fact}</p>
			{/if}
			{#if credit}
				<p class="credit" data-testid="reveal-credit">{t().photoCredit}: {credit}</p>
			{/if}
		</div>
	{/if}

	{#if done}
		<aside class="panel" data-testid="reveal-results">
			<div
				class="winner-card"
				data-testid="round-winner"
				data-winners={result.winnerPlayerIds.join(',')}
				data-winner-teams={result.winnerTeams?.join(',')}
			>
				{#if winners.length === 0}
					<div class="nobody">
						<svg viewBox="0 0 48 48" aria-hidden="true"
							><circle cx="24" cy="24" r="19" /><circle cx="24" cy="24" r="10" /><path d="M10 38 38 10" /></svg
						>
						<p class="w-title">{t().nobodyGuessed}</p>
						<p class="w-sub">{t().noPointThisRound}</p>
					</div>
				{:else}
					<div class="faces" class:many={winners.length > 1}>
						{#each winners as w (w.id)}
							<span class="wface">
								<svg class="crown" viewBox="0 0 24 18" aria-hidden="true"
									><path d="M2 16h20l1-11-6 4-5-8-5 8-6-4z" /></svg
								>
								<Avatar nickname={w.nickname} color={w.color} size={winners.length > 1 ? '3.6rem' : '4.6rem'} ring />
								<span class="burst" aria-hidden="true">
									{#each Array.from({ length: 12 }, (_, i) => i) as i (i)}
										<i style:--a="{i * 30}deg" style:--c={i % 2 ? w.color : 'var(--tv-gold)'}></i>
									{/each}
								</span>
							</span>
						{/each}
					</div>
					<p class="w-names">
						{#each winners as w, i (w.id)}
							{#if i > 0}<span class="amp">{' & '}</span>{/if}<span style:color="color-mix(in srgb, {w.color} 60%, white)"
								>{w.nickname}</span
							>
						{/each}
					</p>
					<p class="w-title">{winners.length > 1 ? t().shareRound : t().winsRound}</p>
					{#if winnerKm !== null}<p class="w-sub">{t().away(tc().km(winnerKm))}</p>{/if}
					{#if result.winnerTeams?.length}
						<p class="w-team" data-testid="round-winner-team">
							{tc().teamTookRound(gameTeamNames(game, result.winnerTeams, locale()))}
						</p>
					{/if}
				{/if}
			</div>

			{#if guessCount > 0}
				<div class="ranking">
					<p class="r-head">{t().closest}</p>
					<ol class="rows" data-testid="ranking" bind:this={rowsEl}>
						{#each listed as g, i (g.playerId)}
							{@const p = byId.get(g.playerId)}
							<li class={['row', { win: g.isWinner }]} style:--i={i} data-testid="ranking-row">
								<span class="rank">{g.rank}</span>
								<Avatar nickname={p?.nickname ?? '?'} color={p?.color ?? '#888'} size="1.45rem" />
								<span class="rname">{p?.nickname ?? '?'}</span>
								<span class="km">{tc().km(g.distanceKm)}</span>
							</li>
						{/each}
					</ol>
					{#if guessCount > listMax}<p class="more" data-testid="ranking-more">{t().more(guessCount - listMax)}</p>{/if}
					{#if result.noGuessPlayerIds.length}
						<p class="noguess">{t().withoutGuess(result.noGuessPlayerIds.length)}</p>
					{/if}
				</div>
			{/if}
		</aside>
	{/if}
</section>

<style>
	.reveal {
		position: absolute;
		inset: 0;
		overflow: hidden;
		--margin: 2.4vh;
	}
	.map {
		position: absolute;
		inset: 0;
		--map-attribution-inset: 0.5rem;
	}
	/* Legibility gradients behind the overlays (top and bottom edges). */
	.shade {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background:
			linear-gradient(180deg, rgb(4 9 20 / 0.55) 0%, transparent 16%),
			linear-gradient(0deg, rgb(4 9 20 / 0.85) 0%, rgb(4 9 20 / 0.5) calc(var(--bottom-h) * 0.9), transparent var(--bottom-h));
		z-index: 3;
	}
	.top {
		position: absolute;
		z-index: 5;
		top: var(--margin);
		left: 2vw;
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.round-pill {
		padding: 0.45rem 1rem;
		border-radius: 999px;
		background: var(--tv-glass);
		border: 1px solid var(--tv-line);
		font-size: 1.1rem;
		font-weight: 800;
		letter-spacing: 0.02em;
		backdrop-filter: blur(10px);
	}
	.round-pill.sd {
		background: var(--tv-red);
		border-color: transparent;
		color: #fff;
	}

	/* --- Suspense ---------------------------------------------------------------------------- */
	.suspense {
		position: absolute;
		z-index: 5;
		left: 0;
		right: 0;
		bottom: calc(var(--margin) + 1vh);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		text-align: center;
		animation: rise 700ms var(--ease-out) both;
	}
	.headline {
		font-size: clamp(2.2rem, 8vh, 3.6rem);
		font-weight: 900;
		letter-spacing: -0.03em;
		line-height: 1.05;
		text-shadow: 0 0.2rem 1.5rem rgb(0 0 0 / 0.7);
	}
	.headline.flying {
		color: var(--tv-gold);
		animation: zoom 2.8s ease-in both;
	}
	.ell i {
		font-style: normal;
		animation: blink 1.2s infinite both;
	}
	.ell i:nth-child(2) {
		animation-delay: 0.2s;
	}
	.ell i:nth-child(3) {
		animation-delay: 0.4s;
	}
	.sub {
		font-size: 1.3rem;
		font-weight: 650;
		color: var(--tv-ink-2);
	}
	.drum {
		position: relative;
		width: min(30rem, 50vw);
		height: 0.4rem;
		margin-top: 0.6rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.14);
		overflow: hidden;
	}
	.drum i {
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, var(--tv-gold-2), var(--tv-gold));
		transform-origin: left;
		animation: fill var(--d) linear var(--e) both;
	}
	@keyframes fill {
		from {
			transform: scaleX(0);
		}
	}
	@keyframes zoom {
		from {
			transform: scale(0.9);
			opacity: 0;
		}
		15% {
			opacity: 1;
		}
		to {
			transform: scale(1.06);
		}
	}
	@keyframes blink {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}

	/* --- Answer (lower third) --------------------------------------------------------------- */
	.answer {
		position: absolute;
		z-index: 5;
		left: 2.6vw;
		right: calc(var(--panel-w) + 4vw);
		bottom: calc(var(--margin) + 0.6vh);
		max-height: calc(var(--bottom-h) + 4vh);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.place {
		position: relative;
		width: fit-content;
		max-width: 100%;
		font-weight: 900;
		letter-spacing: -0.035em;
		line-height: 1;
		color: #fff;
		text-shadow: 0 0.15rem 1.2rem rgb(0 0 0 / 0.7);
		animation: land 900ms cubic-bezier(0.2, 1.3, 0.4, 1) both;
		padding-bottom: 0.12em;
	}
	.place::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
		height: 0.08em;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--tv-gold), var(--tv-gold-2));
		transform-origin: left;
		animation: sweep 900ms 250ms var(--ease-out) both;
	}
	.fact {
		max-width: 52ch;
		font-weight: 550;
		line-height: 1.38;
		color: var(--tv-ink);
		text-shadow: 0 0.1rem 0.8rem rgb(0 0 0 / 0.8);
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		animation: rise 800ms 700ms var(--ease-out) both;
	}
	.credit {
		max-width: 52ch;
		font-size: 0.72rem;
		line-height: 1.35;
		color: var(--tv-ink-3);
		text-shadow: 0 0.1rem 0.6rem rgb(0 0 0 / 0.8);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		animation: rise 800ms 900ms var(--ease-out) both;
	}
	@keyframes land {
		from {
			opacity: 0;
			transform: translateY(1.5rem) scale(0.92);
			filter: blur(6px);
		}
	}
	@keyframes sweep {
		from {
			transform: scaleX(0);
		}
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(1.2rem);
		}
	}

	/* --- Results panel ---------------------------------------------------------------------- */
	.panel {
		position: absolute;
		z-index: 6;
		top: calc(var(--margin) + 4.4rem);
		right: 2vw;
		max-height: calc(100% - var(--margin) * 2 - 4.4rem);
		width: var(--panel-w);
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		padding: 1.4rem 1.4rem 1.2rem;
		border-radius: 1.6rem;
		background: linear-gradient(180deg, rgb(14 26 52 / 0.92), rgb(8 16 34 / 0.92));
		border: 1px solid var(--tv-line);
		box-shadow: 0 1.5rem 4rem rgb(0 0 0 / 0.55);
		backdrop-filter: blur(14px);
		overflow: hidden;
		animation: panel-in 700ms var(--ease-out) both;
	}
	@keyframes panel-in {
		from {
			opacity: 0;
			transform: translateX(3rem);
		}
	}
	.winner-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 0.2rem;
		flex: none;
	}
	.faces {
		display: flex;
		justify-content: center;
		gap: 1.2rem;
		margin: 1rem 0 0.6rem;
	}
	.wface {
		position: relative;
		display: inline-grid;
		place-items: center;
		animation: crown-pop 800ms 250ms cubic-bezier(0.3, 1.7, 0.5, 1) both;
	}
	.crown {
		position: absolute;
		top: -1.15rem;
		width: 2.2rem;
		height: 1.65rem;
		fill: var(--tv-gold);
		filter: drop-shadow(0 0.15rem 0.3rem rgb(0 0 0 / 0.5));
		z-index: 1;
		animation: crown-drop 700ms 650ms cubic-bezier(0.3, 1.6, 0.5, 1) both;
	}
	.faces.many .crown {
		top: -1rem;
		width: 1.8rem;
	}
	.burst {
		position: absolute;
		inset: 50% auto auto 50%;
	}
	.burst i {
		position: absolute;
		width: 0.45rem;
		height: 0.45rem;
		margin: -0.225rem;
		border-radius: 0.1rem;
		background: var(--c);
		transform: rotate(var(--a)) translateY(0);
		opacity: 0;
		animation: burst 1.1s 450ms var(--ease-out) both;
	}
	@keyframes burst {
		0% {
			opacity: 1;
			transform: rotate(var(--a)) translateY(-1rem) scale(1);
		}
		100% {
			opacity: 0;
			transform: rotate(var(--a)) translateY(-4.2rem) scale(0.4);
		}
	}
	@keyframes crown-pop {
		from {
			opacity: 0;
			transform: scale(0.3);
		}
	}
	@keyframes crown-drop {
		from {
			opacity: 0;
			transform: translateY(-1.5rem) rotate(-15deg);
		}
	}
	.w-names {
		font-size: 2.2rem;
		font-weight: 900;
		letter-spacing: -0.02em;
		line-height: 1.1;
		overflow-wrap: anywhere;
		animation: rise 600ms 450ms var(--ease-out) both;
	}
	.amp {
		color: var(--tv-ink-3);
		font-weight: 700;
	}
	.w-title {
		font-size: 1.3rem;
		font-weight: 750;
		color: var(--tv-gold);
		animation: rise 600ms 550ms var(--ease-out) both;
	}
	.w-sub {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--tv-ink-2);
		font-variant-numeric: tabular-nums;
		animation: rise 600ms 650ms var(--ease-out) both;
	}
	.w-team {
		margin-top: 0.4rem;
		padding: 0.25rem 1rem;
		border-radius: 999px;
		background: var(--tv-gold);
		color: #1d1400;
		font-size: 1.3rem;
		font-weight: 850;
		overflow-wrap: anywhere;
		animation: rise 600ms 750ms var(--ease-out) both;
	}
	.nobody {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 1rem 0;
	}
	.nobody svg {
		width: 4.5rem;
		height: 4.5rem;
		fill: none;
		stroke: var(--tv-ink-3);
		stroke-width: 3;
		stroke-linecap: round;
		margin-bottom: 0.4rem;
	}
	.nobody .w-title {
		font-size: 1.6rem;
		color: var(--tv-ink);
		line-height: 1.2;
	}

	.ranking {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		border-top: 1px solid var(--tv-line);
		padding-top: 1rem;
	}
	.r-head {
		font-size: 0.85rem;
		font-weight: 800;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--tv-ink-3);
	}
	.rows {
		flex: 1 1 auto;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-height: 2.2rem;
		overflow: hidden;
	}
	.row {
		display: grid;
		grid-template-columns: 1.6rem auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.6rem;
		padding: 0.3rem 0.6rem 0.3rem 0.4rem;
		border-radius: 0.8rem;
		font-size: 1.1rem;
		animation: row-in 500ms calc(900ms + var(--i) * 120ms) var(--ease-out) both;
	}
	.row.win {
		background: rgb(255 194 61 / 0.16);
		box-shadow: inset 0 0 0 1px rgb(255 194 61 / 0.45);
	}
	.rank {
		font-weight: 850;
		color: var(--tv-ink-3);
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.win .rank {
		color: var(--tv-gold);
	}
	.rname {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.km {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		color: var(--tv-ink-2);
	}
	.more,
	.noguess {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--tv-ink-3);
		padding-left: 0.4rem;
		animation: rise 500ms 1.5s var(--ease-out) both;
	}
	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateX(1.5rem);
		}
	}

	/* Skip / reload / standings: everything is already there, no long build-up. */
	.instant .place,
	.instant .place::after,
	.instant .fact,
	.instant .panel,
	.instant .wface,
	.instant .crown,
	.instant .w-names,
	.instant .w-title,
	.instant .w-sub,
	.instant .w-team,
	.instant .row,
	.instant .more,
	.instant .noguess {
		animation-delay: 0ms;
		animation-duration: 400ms;
	}
	.instant .burst {
		display: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.burst {
			display: none;
		}
		.place {
			filter: none;
		}
	}
</style>
