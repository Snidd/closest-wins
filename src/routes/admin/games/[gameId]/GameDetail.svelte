<script lang="ts">
	import type { GameHistoryDetail } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import PlayerChip from '#lib/ui/PlayerChip.svelte';
	import PageHeader from '../../_components/PageHeader.svelte';
	import Badge from '../../_components/Badge.svelte';
	import { fmtCoord, formatDate } from '../../_components/util.ts';

	let { game }: { game: GameHistoryDetail } = $props();
	const t = useT(admin);
	const c = useT(common);
	const locale = useLocale();

	const players = $derived(new Map(game.standings.map((s) => [s.playerId, s])));
	const roundTitles = $derived.by(() => {
		let regular = 0;
		let suddenDeath = 0;
		return game.rounds.map((r) =>
			r.isSuddenDeath ? `${t().suddenDeathRound} ${++suddenDeath}` : t().roundN(++regular)
		);
	});
</script>

<PageHeader
	title="{t().colGame} {game.joinCode}"
	back={{ href: '/admin/games', label: t().games }}
	subtitle={game.playlistName ? localized(game.playlistName, 'name', locale()) : t().deletedPlaylist}
/>

<dl class="facts card">
	<div><dt>{t().colStatus}</dt><dd>
		<Badge tone={game.phase === 'finished' ? 'neutral' : 'info'}>{t()[`phase_${game.phase}`]}</Badge>
		{#if game.endedEarly}<Badge tone="warn">{t().endedEarly}</Badge>{/if}
	</dd></div>
	<div><dt>{t().colStarted}</dt><dd>{formatDate(game.createdAt, locale(), true)}</dd></div>
	{#if game.finishedAt}<div><dt>{t().finishedAt}</dt><dd>{formatDate(game.finishedAt, locale(), true)}</dd></div>{/if}
	<div><dt>{t().colPlayers}</dt><dd>{game.playerCount}</dd></div>
	<div><dt>{t().colRounds}</dt><dd>{game.roundsPlayed}</dd></div>
	<div><dt>{t().gameLanguage}</dt><dd>{game.language === 'sv' ? t().swedish : t().english}</dd></div>
	<div class="wide">
		<dt>{game.winners.length > 1 ? c().winners : c().winner}</dt>
		<dd class="chips">
			{#each game.winners as w (w.playerId)}
				<PlayerChip nickname={w.nickname} color={w.color} winner />
			{:else}–{/each}
			{#if game.winners.length > 1}<Badge>{t().sharedWin}</Badge>{/if}
		</dd>
	</div>
</dl>

{#if game.standings.length}
	<section class="card">
		<h2>{c().standings}</h2>
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th scope="col" class="num">{t().rank}</th>
						<th scope="col">{c().player}</th>
						<th scope="col" class="num">{c().roundsWon}</th>
						<th scope="col" class="num">{c().totalDistance}</th>
						<th scope="col" class="num">{t().guesses}</th>
					</tr>
				</thead>
				<tbody>
					{#each game.standings as s (s.playerId)}
						<tr>
							<td class="num">{s.rank}</td>
							<td><PlayerChip nickname={s.nickname} color={s.color} size="sm" winner={game.winners.some((w) => w.playerId === s.playerId)} /></td>
							<td class="num strong">{s.roundsWon}</td>
							<td class="num">{s.guessedRounds ? c().km(s.totalDistanceKm) : '–'}</td>
							<td class="num">{s.guessedRounds}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

{#if game.rounds.length}
	<div class="rounds">
		{#each game.rounds as r, i (r.index)}
			{@const guesses = [...r.guesses].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))}
			<section class="card round" class:sd={r.isSuddenDeath}>
				<header>
					<h3>{roundTitles[i]}</h3>
					<p class="target">
						<strong>{localized(r.target, 'name', locale())}</strong>
						<span class="muted coords">{fmtCoord(r.target.lat)}, {fmtCoord(r.target.lng)}</span>
					</p>
				</header>
				{#if guesses.length === 0}
					<p class="muted">{t().nobodyGuessed}</p>
				{:else}
					<ol class="guesses">
						{#each guesses as g (g.playerId)}
							{@const p = players.get(g.playerId)}
							<li class:win={r.winnerPlayerIds.includes(g.playerId)}>
								<PlayerChip nickname={p?.nickname ?? '?'} color={p?.color ?? '#888888'} size="sm" winner={r.winnerPlayerIds.includes(g.playerId)} />
								<span class="dist">{g.distanceKm === null ? c().noGuess : c().km(g.distanceKm)}</span>
								{#if g.distanceKm !== null}<span class="muted how">{g.locked ? t().locked : t().timeRanOut}</span>{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		margin-bottom: var(--space-4);
		min-width: 0;
	}
	h2 {
		font-size: var(--text-lg);
	}
	h3 {
		font-size: var(--text-md);
	}
	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: var(--space-3) var(--space-5);
		margin: 0 0 var(--space-4);
	}
	.facts dt {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		font-weight: var(--weight-bold);
	}
	.facts dd {
		margin: var(--space-1) 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		align-items: center;
	}
	.wide {
		grid-column: 1 / -1;
	}
	.table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: var(--space-2) var(--space-3);
		text-align: left;
		border-bottom: 1px solid var(--color-border);
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	th {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text-muted);
		white-space: nowrap;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.strong {
		font-weight: var(--weight-bold);
	}
	.rounds {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
		gap: var(--space-4);
	}
	.round {
		margin: 0;
	}
	.sd {
		border-color: var(--color-accent);
	}
	header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.target {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		align-items: baseline;
	}
	.coords {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.guesses {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.guesses li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.dist {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.win .dist {
		font-weight: var(--weight-bold);
	}
	.how {
		font-size: var(--text-xs);
		width: 6rem;
		text-align: right;
	}
</style>
