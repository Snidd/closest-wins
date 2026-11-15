<!-- Standings: place, player, rounds won, total distance; the phone owner's row stands out. -->
<script lang="ts">
	import type { StandingRow } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { player } from '#lib/i18n/player.ts';

	type Props = { rows: StandingRow[]; meId: string; winnerIds?: string[]; caption: string };
	let { rows, meId, winnerIds = [], caption }: Props = $props();
	const t = useT(player);
	const tc = useT(common);
</script>

<table class="standings" data-testid="standings">
	<caption>{caption}</caption>
	<thead>
		<tr>
			<th scope="col" class="rank"><span class="visually-hidden">{t().rank}</span>#</th>
			<th scope="col" class="name">{t().playerCol}</th>
			<th scope="col" class="num" title={tc().roundsWon}>{t().won}</th>
			<th scope="col" class="num dist">{t().total}</th>
		</tr>
	</thead>
	<tbody>
		{#each rows as row (row.playerId)}
			<tr
				class={{ me: row.playerId === meId, winner: winnerIds.includes(row.playerId), offline: !row.connected }}
				style:--c={row.color}
				data-testid={row.playerId === meId ? 'my-row' : undefined}
			>
				<td class="rank">{row.rank}</td>
				<th scope="row" class="name">
					<span class="who">
						<span class="dot" aria-hidden="true"></span>
						<span class="nick">{row.nickname}</span>
						{#if row.playerId === meId}<span class="you">{t().you}</span>{/if}
					</span>
				</th>
				<td class="num won">{row.roundsWon}</td>
				<td class="num dist">{row.guessedRounds > 0 ? t().distance(row.totalDistanceKm) : '–'}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.standings {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0 0.25rem;
		font-size: var(--text-sm);
		table-layout: fixed;
	}
	caption {
		text-align: start;
		padding-bottom: var(--space-1);
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		font-weight: var(--weight-bold);
	}
	thead th {
		padding: 0 var(--space-2);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		text-align: start;
	}
	td,
	tbody th {
		padding: var(--space-2);
		background: var(--color-surface);
		font-weight: var(--weight-normal);
		text-align: start;
		vertical-align: middle;
	}
	tbody tr > :first-child {
		border-radius: var(--radius-md) 0 0 var(--radius-md);
	}
	tbody tr > :last-child {
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
	}
	.rank {
		width: 2.25rem;
		text-align: center !important;
		font-weight: var(--weight-bold) !important;
		font-variant-numeric: tabular-nums;
	}
	.num {
		width: 3.5rem;
		text-align: end !important;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.dist {
		width: 6rem;
	}
	.won {
		font-weight: var(--weight-bold) !important;
		font-size: var(--text-md);
	}
	.name {
		overflow: hidden;
	}
	tbody .name {
		font-weight: var(--weight-medium) !important;
	}
	.who {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.dot {
		flex: none;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: var(--c);
	}
	.nick {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.you {
		flex: none;
		padding: 0 0.45em;
		border-radius: var(--radius-pill);
		background: var(--color-primary);
		color: var(--color-primary-contrast);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
	}
	tr.me > * {
		background: color-mix(in oklab, var(--color-primary) 16%, var(--color-surface));
		box-shadow:
			inset 0 2px 0 var(--color-primary),
			inset 0 -2px 0 var(--color-primary);
	}
	tr.me > :first-child {
		box-shadow:
			inset 2px 0 0 var(--color-primary),
			inset 0 2px 0 var(--color-primary),
			inset 0 -2px 0 var(--color-primary);
	}
	tr.me > :last-child {
		box-shadow:
			inset -2px 0 0 var(--color-primary),
			inset 0 2px 0 var(--color-primary),
			inset 0 -2px 0 var(--color-primary);
	}
	tr.winner .rank {
		color: var(--color-accent-contrast);
		background: var(--color-accent);
	}
	tr.offline .nick {
		opacity: 0.55;
	}
	@media (max-width: 22.5rem) {
		.num {
			width: 2.75rem;
		}
		.dist {
			width: 5.25rem;
		}
		td,
		tbody th {
			padding: var(--space-2) var(--space-1);
		}
	}
</style>
