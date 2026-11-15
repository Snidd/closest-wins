<script lang="ts">
	import type { GameHistoryItem } from '#lib/game/types.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import PlayerChip from '#lib/ui/PlayerChip.svelte';
	import EmptyState from '../_components/EmptyState.svelte';
	import Badge from '../_components/Badge.svelte';
	import { formatDate } from '../_components/util.ts';

	type Props = { games: GameHistoryItem[]; pageNo: number; pageSize: number };
	let { games, pageNo, pageSize }: Props = $props();
	const t = useT(admin);
	const locale = useLocale();

	const phaseLabel = (g: GameHistoryItem) => t()[`phase_${g.phase}`];
</script>

{#if games.length === 0 && pageNo === 1}
	<EmptyState title={t().noGames} hint={t().noGamesHint} />
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">{t().colStarted}</th>
					<th scope="col">{t().colGame}</th>
					<th scope="col">{t().colStatus}</th>
					<th scope="col" class="num">{t().colPlayers}</th>
					<th scope="col" class="num">{t().colRounds}</th>
					<th scope="col">{t().colWinner}</th>
				</tr>
			</thead>
			<tbody>
				{#each games as g (g.id)}
					<tr>
						<td class="date">
							<a class="row-link" href="/admin/games/{g.id}">{formatDate(g.createdAt, locale(), true)}</a>
						</td>
						<td>
							<span class="code">{g.joinCode}</span>
							<span class="muted playlist">
								{g.playlistName ? localized(g.playlistName, 'name', locale()) : t().deletedPlaylist}
							</span>
						</td>
						<td>
							<Badge tone={g.phase === 'finished' ? 'neutral' : 'info'}>{phaseLabel(g)}</Badge>
							{#if g.endedEarly}<Badge tone="warn">{t().endedEarly}</Badge>{/if}
						</td>
						<td class="num">{g.playerCount}</td>
						<td class="num">{g.roundsPlayed}</td>
						<td>
							<span class="winners">
								{#each g.winners as w (w.playerId)}
									<PlayerChip nickname={w.nickname} color={w.color} size="sm" />
								{:else}
									<span class="muted">–</span>
								{/each}
							</span>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if pageNo > 1 || games.length === pageSize}
		<nav class="pager" aria-label={t().games}>
			<Button variant="secondary" size="sm" href={pageNo > 1 ? `?page=${pageNo - 1}` : undefined} disabled={pageNo <= 1}
				>← {t().previous}</Button
			>
			<Button
				variant="secondary"
				size="sm"
				href={games.length === pageSize ? `?page=${pageNo + 1}` : undefined}
				disabled={games.length < pageSize}>{t().nextPage} →</Button
			>
		</nav>
	{/if}
{/if}

<style>
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: var(--space-3);
		text-align: left;
		vertical-align: middle;
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
	tbody tr {
		position: relative;
	}
	tbody tr:hover {
		background: var(--color-surface-2);
	}
	.row-link {
		color: var(--color-text);
		font-weight: var(--weight-medium);
		text-decoration: none;
		white-space: nowrap;
	}
	.row-link::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.row-link:focus-visible {
		outline: none;
	}
	tbody tr:has(.row-link:focus-visible) {
		outline: 3px solid var(--color-focus);
		outline-offset: -3px;
	}
	.code {
		font-family: var(--font-mono);
		font-weight: var(--weight-bold);
		letter-spacing: 0.1em;
		margin-right: var(--space-2);
	}
	.playlist {
		font-size: var(--text-sm);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.winners {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.pager {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
</style>
