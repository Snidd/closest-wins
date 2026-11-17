<!--
  Rank · player · rounds won · total distance. Winners (if given) get a gold rank.
  In a teams game (`teams`): one block per team (rank · name · rounds won) with its members
  (colour, nickname, distance) inside it; `highlightTeams` get the gold rank.
-->
<script lang="ts">
	import type { StandingRow, TeamStandingRow } from '#lib/game/types.ts';
	import { teamName } from '#lib/game/teams.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';

	type Props = { rows: StandingRow[]; highlight?: string[]; teams?: TeamStandingRow[]; highlightTeams?: number[] };
	let { rows, highlight = [], teams, highlightTeams = [] }: Props = $props();

	const t = useT(host);
	const c = useT(common);
	const locale = useLocale();
	const lit = $derived(new Set(highlight));
	const litTeams = $derived(new Set(highlightTeams));
</script>

{#if teams}
	<table class="standings teams" data-testid="team-standings">
		<thead>
			<tr>
				<th class="rank" scope="col"><span class="visually-hidden">{t().rank}</span></th>
				<th class="player" scope="col">{c().team}</th>
				<th class="num" scope="col">{t().wins}</th>
				<th class="num dist" scope="col">{t().total}</th>
			</tr>
		</thead>
		{#each teams as team (team.team)}
			<tbody class={{ lit: litTeams.has(team.team) }} data-testid="team-row" data-team={team.team}>
				<tr class="team-head">
					<td class="rank">{team.rank}</td>
					<th class="player" scope="rowgroup"><span class="name">{teamName(team.team, team.name, locale())}</span></th>
					<td class="num wins">{team.roundsWon}</td>
					<td class="num dist"></td>
				</tr>
				{#each team.members as r (r.playerId)}
					<tr class={['member', { offline: !r.connected }]} data-testid="team-member" data-player={r.nickname}>
						<td class="rank"></td>
						<td class="player">
							<span class="pcell">
								<span class="dot" style:background={r.color} aria-hidden="true"></span>
								<span class="name">{r.nickname}</span>
							</span>
						</td>
						<td class="num"></td>
						<td class="num dist">{r.guessedRounds > 0 ? c().km(r.totalDistanceKm) : '–'}</td>
					</tr>
				{/each}
			</tbody>
		{/each}
	</table>
{:else}
	<table class="standings" data-testid="standings">
		<thead>
			<tr>
				<th class="rank" scope="col"><span class="visually-hidden">{t().rank}</span></th>
				<th class="player" scope="col">{c().player}</th>
				<th class="num" scope="col">{t().wins}</th>
				<th class="num dist" scope="col">{t().total}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.playerId)}
				<tr class={{ lit: lit.has(r.playerId), offline: !r.connected }} data-testid="standing-row" data-player={r.nickname}>
					<td class="rank">{r.rank}</td>
					<td class="player">
						<span class="pcell">
							<span class="dot" style:background={r.color} aria-hidden="true"></span>
							<span class="name">{r.nickname}</span>
						</span>
					</td>
					<td class="num wins">{r.roundsWon}</td>
					<td class="num dist">{r.guessedRounds > 0 ? c().km(r.totalDistanceKm) : '–'}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.standings {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	th {
		padding: 0 0 var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		text-align: left;
	}
	td {
		padding: var(--space-2) 0;
		border-top: 1px solid var(--color-border);
		vertical-align: middle;
	}
	.rank {
		width: 2rem;
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.lit .rank {
		color: var(--color-accent);
	}
	.player {
		width: auto;
	}
	.pcell {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		min-width: 0;
	}
	.dot {
		flex: none;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
	}
	.name {
		min-width: 0;
		font-weight: var(--weight-bold);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.offline .name,
	.offline .dot {
		opacity: 0.5;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	th.num {
		width: 4rem;
	}
	th.dist {
		width: 6rem;
	}
	.wins {
		font-size: var(--text-xl);
		font-weight: var(--weight-bold);
	}
	td.dist {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.lit td {
		background: color-mix(in oklab, var(--color-accent) 14%, transparent);
	}
	.team-head td,
	.team-head th {
		padding-top: var(--space-3);
		border-top: 2px solid var(--color-border);
		text-align: left;
		font-size: var(--text-md);
		letter-spacing: 0;
		text-transform: none;
		color: var(--color-text);
	}
	.team-head .rank {
		color: var(--color-text-muted);
	}
	.lit .team-head .rank {
		color: var(--color-accent);
	}
	.lit .team-head th {
		background: color-mix(in oklab, var(--color-accent) 14%, transparent);
	}
	.member td {
		border-top: 0;
		padding: 0;
	}
	.member .pcell {
		min-height: 2.25rem;
	}
	.member .name {
		font-weight: var(--weight-medium);
	}
</style>
