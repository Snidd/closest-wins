<!--
  Scoreboard: rank, player, movement since the last round, rounds won and total distance.
  Flows into 1–3 columns by player count so 40 players fit without scrolling.
  In a teams game (`teams`): one block per team (rank, name, rounds won) with its members
  (avatar, name, distance) inside it, flowing into columns the same way.
-->
<script lang="ts">
	import type { StandingRow, TeamStandingRow } from '#lib/game/types.ts';
	import { teamName } from '#lib/game/teams.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import { common } from '#lib/i18n/common.ts';
	import Avatar from './Avatar.svelte';
	import type { Movement } from './tv.svelte.ts';

	type Props = {
		rows: StandingRow[];
		movement?: Map<string, Movement> | null;
		highlight?: string[];
		/** Show at most this many rows, then "+ N more". */
		max?: number;
		/** Force a column count (default: by row count). */
		columns?: number;
		/** Force a row size (default: by row and column count). */
		size?: 'xl' | 'lg' | 'md' | 'sm';
		/** Teams game: show these team rows instead of `rows`. */
		teams?: TeamStandingRow[];
		/** Teams that get the gold highlight (round winners, or the game's winners). */
		highlightTeams?: number[];
	};
	let {
		rows,
		movement = null,
		highlight = [],
		max = 40,
		columns,
		size: sizeProp,
		teams,
		highlightTeams = []
	}: Props = $props();
	const t = useT(tvDict);
	const tc = useT(common);
	const locale = useLocale();

	// Team blocks: a line per team plus a line per member decide the columns and the size.
	const teamLines = $derived(teams ? teams.reduce((n, team) => n + 1 + team.members.length, 0) : 0);
	const teamCols = $derived(Math.min(columns ?? 3, teamLines <= 12 ? 1 : teamLines <= 26 ? 2 : 3));
	const teamLinesPerCol = $derived(Math.ceil(teamLines / teamCols));
	const teamSize = $derived(
		teamCols === 1 ? (teamLines <= 8 ? 'xl' : 'lg') : teamLinesPerCol > 16 ? 'sm' : 'md'
	);
	const hlTeams = $derived(new Set(highlightTeams));

	const shown = $derived(rows.slice(0, max));
	const cols = $derived(columns ?? (shown.length <= 9 ? 1 : shown.length <= 18 ? 2 : 3));
	const perCol = $derived(Math.ceil(shown.length / cols));
	const size = $derived(sizeProp ?? (cols === 1 ? (shown.length <= 6 ? 'xl' : 'lg') : cols === 2 ? 'md' : 'sm'));
	const hl = $derived(new Set(highlight));
</script>

{#if teams}
	<div class={['team-table', teamSize]} style:--cols={teamCols} data-testid="team-standings">
		{#each teams as team, i (team.team)}
			<div
				class={['team', { lead: team.rank === 1 && team.roundsWon > 0, hl: hlTeams.has(team.team) }]}
				style:--i={i}
				data-testid="team-row"
				data-team={team.team}
				data-rank={team.rank}
			>
				<div class="row team-head">
					<span class="rank">{team.rank}</span>
					<span class="name team-name">{teamName(team.team, team.name, locale())}</span>
					<span class="h-wins">{t().wins}</span>
					<span class="wins">{team.roundsWon}</span>
				</div>
				{#each team.members as r (r.playerId)}
					<div class={['row', 'member', { offline: !r.connected }]} data-testid="team-member" data-player-id={r.playerId}>
						<span></span>
						<Avatar nickname={r.nickname} color={r.color} size="1.4em" offline={!r.connected} />
						<span class="name">{r.nickname}</span>
						<span class="dist">{r.guessedRounds ? tc().km(r.totalDistanceKm) : '–'}</span>
					</div>
				{/each}
			</div>
		{/each}
	</div>
{:else}
	<div class={['table', size]} style:--cols={cols} style:--rows={perCol} data-testid="standings-table">
		{#each Array.from({ length: cols }, (_, i) => i) as c (c)}
			<div class="colhead" style:grid-column={c + 1} aria-hidden={c > 0}>
				<span class="h-fill"></span>
				<span class="h-wins">{t().wins}</span>
				<span class="h-dist">{t().distance}</span>
			</div>
		{/each}
		{#each shown as r, i (r.playerId)}
			{@const m = movement?.get(r.playerId)}
			<div
				class={['row', { lead: r.rank === 1 && r.roundsWon > 0, hl: hl.has(r.playerId), offline: !r.connected }]}
				style:grid-column={Math.floor(i / perCol) + 1}
				style:grid-row={(i % perCol) + 2}
				style:--i={i}
				data-testid="standings-row"
				data-player-id={r.playerId}
				data-rank={r.rank}
			>
				<span class="rank">{r.rank}</span>
				<Avatar nickname={r.nickname} color={r.color} size="1.6em" offline={!r.connected} />
				<span class="name">{r.nickname}</span>
				<span class="move">
					{#if m?.wonRound}<span class="plus" title="+1">+1</span>{/if}
					{#if m && m.delta > 0}
						<span class="up" aria-label={t().movedUp(m.delta)}>▲{m.delta}</span>
					{/if}
				</span>
				<span class="wins">{r.roundsWon}</span>
				<span class="dist">{r.guessedRounds ? tc().km(r.totalDistanceKm) : '–'}</span>
			</div>
		{/each}
	</div>
	{#if rows.length > shown.length}
		<p class="more">{t().more(rows.length - shown.length)}</p>
	{/if}
{/if}

<style>
	.table {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
		grid-template-rows: auto repeat(var(--rows), auto);
		column-gap: 2.2vw;
		row-gap: var(--gap);
		align-content: start;
		min-height: 0;
	}
	.xl {
		font-size: 1.6rem;
		--gap: 0.55rem;
	}
	.lg {
		font-size: 1.25rem;
		--gap: 0.4rem;
	}
	.md {
		font-size: 1.05rem;
		--gap: 0.32rem;
	}
	.sm {
		font-size: 0.85rem;
		--gap: 0.22rem;
	}
	.colhead,
	.row {
		line-height: 1.2;
		display: grid;
		grid-template-columns: 1.6em 1.6em minmax(0, 1fr) auto 2.6em 5.2em;
		align-items: center;
		gap: 0.55em;
	}
	.colhead {
		grid-row: 1;
		padding: 0 0.6em 0 0.4em;
	}
	.h-fill {
		grid-column: 1 / 5;
	}
	.h-wins,
	.h-dist {
		font-size: max(0.8rem, 0.55em);
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--tv-ink-3);
		white-space: nowrap;
	}
	.h-wins {
		text-align: center;
	}
	.h-dist {
		text-align: right;
	}
	.row {
		padding: 0.28em 0.6em 0.28em 0.4em;
		border-radius: 0.6em;
		background: rgb(255 255 255 / 0.05);
		animation: row-in 600ms calc(var(--i) * 45ms + 150ms) var(--ease-out) both;
	}
	.row.lead {
		background: linear-gradient(90deg, rgb(255 194 61 / 0.24), rgb(255 194 61 / 0.06));
		box-shadow: inset 0 0 0 1px rgb(255 194 61 / 0.5);
	}
	.row.hl:not(.lead) {
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.35);
	}
	.rank {
		font-weight: 850;
		text-align: center;
		color: var(--tv-ink-3);
		font-variant-numeric: tabular-nums;
	}
	.lead .rank {
		color: var(--tv-gold);
	}
	.name {
		font-weight: 750;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.offline .name {
		color: var(--tv-ink-3);
	}
	.move {
		display: inline-flex;
		align-items: center;
		gap: 0.3em;
		font-size: 0.75em;
		font-weight: 850;
		font-variant-numeric: tabular-nums;
		min-width: 0;
	}
	.plus {
		padding: 0.05em 0.4em;
		border-radius: 999px;
		background: var(--tv-gold);
		color: #1d1400;
		animation: plus-pop 700ms 900ms cubic-bezier(0.3, 1.8, 0.5, 1) both;
	}
	.up {
		color: #3ddc84;
	}
	.wins {
		line-height: 1;
		font-size: 1.35em;
		font-weight: 900;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}
	.dist {
		text-align: right;
		font-weight: 600;
		color: var(--tv-ink-2);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		font-size: 0.85em;
	}
	.sm .dist {
		font-size: 0.95em;
	}
	/* Dense rows for big rooms. */
	.sm .row,
	.sm .colhead {
		grid-template-columns: 1.3em 1.3em minmax(0, 1fr) auto 2.8em 5.6em;
		gap: 0.45em;
	}
	.sm .row {
		padding-block: 0.14em;
	}
	.sm .row :global(.avatar) {
		--av-size: 1.3em !important;
	}
	/* --- Teams ------------------------------------------------------------------------------ */
	.team-table {
		column-count: var(--cols);
		column-gap: 2.2vw;
		--gap: 0.4rem;
	}
	.team-table.xl {
		font-size: 1.5rem;
	}
	.team {
		break-inside: avoid;
		display: flex;
		flex-direction: column;
		gap: 0.15em;
		margin-bottom: var(--gap);
		padding: 0.3em 0;
		border-radius: 0.6em;
		background: rgb(255 255 255 / 0.05);
		animation: row-in 600ms calc(var(--i) * 80ms + 150ms) var(--ease-out) both;
	}
	.team.lead {
		background: linear-gradient(90deg, rgb(255 194 61 / 0.24), rgb(255 194 61 / 0.06));
		box-shadow: inset 0 0 0 1px rgb(255 194 61 / 0.5);
	}
	.team.hl:not(.lead) {
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.35);
	}
	.team .row {
		padding: 0.1em 0.6em 0.1em 0.4em;
		background: none;
		animation: none;
	}
	.team-head {
		grid-template-columns: 1.6em minmax(0, 1fr) auto 2.6em;
	}
	.team-head .h-wins {
		text-align: right;
	}
	.team-name {
		font-size: 1.15em;
		font-weight: 850;
	}
	.lead .team-head .rank {
		color: var(--tv-gold);
	}
	.member {
		grid-template-columns: 1.6em 1.4em minmax(0, 1fr) auto;
		font-size: 0.85em;
	}
	.member .name {
		font-weight: 650;
	}
	.more {
		margin-top: 0.6rem;
		font-size: 1rem;
		color: var(--tv-ink-3);
		font-weight: 600;
	}
	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateY(0.8rem);
		}
	}
	@keyframes plus-pop {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
	}
</style>
