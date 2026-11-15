<!-- Playlists list: location count, missing-translation count, timer. -->
<script lang="ts">
	import { listPlaylists } from '#lib/remote/content.remote.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import PageHeader from '../_components/PageHeader.svelte';
	import EmptyState from '../_components/EmptyState.svelte';
	import Badge from '../_components/Badge.svelte';
	import { formatDate } from '../_components/util.ts';
	import { fresh } from '../_components/fresh.svelte.ts';

	const t = useT(admin);
	const c = useT(common);
	const locale = useLocale();

	const playlistsQuery = fresh(() => listPlaylists());
	const playlists = $derived(await playlistsQuery());

	const otherName = (p: { nameSv: string | null; nameEn: string | null }) => {
		const primary = localized(p, 'name', locale());
		const other = locale() === 'sv' ? p.nameEn : p.nameSv;
		return other && other !== primary ? other : null;
	};
</script>

<svelte:head><title>{t().playlists} · {t().admin} · {c().appName}</title></svelte:head>

<PageHeader title={t().playlists} subtitle={t().playlistCountLabel(playlists.length)}>
	{#snippet actions()}
		<Button href="/admin/playlists/new">+ {t().newPlaylist}</Button>
	{/snippet}
</PageHeader>

{#if playlists.length === 0}
	<EmptyState title={t().noPlaylists} hint={t().noPlaylistsHint}>
		<Button href="/admin/playlists/new">+ {t().newPlaylist}</Button>
	</EmptyState>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					<th scope="col">{t().colPlaylist}</th>
					<th scope="col" class="num">{t().colLocations}</th>
					<th scope="col">{t().colMissing}</th>
					<th scope="col" class="num">{t().colTimer}</th>
					<th scope="col" class="date">{t().updated}</th>
				</tr>
			</thead>
			<tbody>
				{#each playlists as p (p.id)}
					<tr>
						<td class="name-col">
							<a class="row-link" href="/admin/playlists/{p.id}">{localized(p, 'name', locale()) || t().untitled}</a>
							{#if otherName(p)}<span class="other muted">{otherName(p)}</span>{/if}
							{#if !p.nameSv || !p.nameEn}
								<Badge tone="warn">{t().missingLang(!p.nameSv ? t().sv : t().en)}</Badge>
							{/if}
						</td>
						<td class="num">{p.locationCount}</td>
						<td>
							{#if p.missingTranslationCount > 0}
								<Badge tone="warn">{t().missingCount(p.missingTranslationCount)}</Badge>
							{:else if p.locationCount > 0}
								<Badge tone="ok">{t().missingCount(0)}</Badge>
							{:else}
								<span class="muted">–</span>
							{/if}
						</td>
						<td class="num">{t().timerSeconds(p.defaultTimerSeconds)}</td>
						<td class="date muted">{formatDate(p.updatedAt, locale())}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
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
	.name-col {
		min-width: 14rem;
	}
	.row-link {
		font-weight: var(--weight-bold);
		color: var(--color-text);
		text-decoration: none;
		margin-right: var(--space-2);
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
	.other {
		display: block;
		font-size: var(--text-sm);
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	td.date {
		white-space: nowrap;
		font-size: var(--text-sm);
	}
	@media (max-width: 40rem) {
		.date {
			display: none;
		}
	}
</style>
