<!-- Locations list: search (both languages), pagination, translation badges, playlist usage. -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { listLocations } from '#lib/remote/content.remote.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import PageHeader from '../_components/PageHeader.svelte';
	import EmptyState from '../_components/EmptyState.svelte';
	import MissingBadges from '../_components/MissingBadges.svelte';
	import Thumb from '../_components/Thumb.svelte';
	import Badge from '../_components/Badge.svelte';
	import { formatDate } from '../_components/util.ts';
	import { fresh } from '../_components/fresh.svelte.ts';

	const PAGE_SIZE = 25;
	const t = useT(admin);
	const c = useT(common);
	const locale = useLocale();

	const urlQuery = $derived(page.url.searchParams.get('q') ?? '');
	const pageNo = $derived(Math.max(1, Number(page.url.searchParams.get('page')) || 1));
	const locationsQuery = fresh(() =>
		listLocations({ query: urlQuery || undefined, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE })
	);
	const result = $derived(await locationsQuery());
	const lastPage = $derived(Math.max(1, Math.ceil(result.total / PAGE_SIZE)));

	let search = $state(page.url.searchParams.get('q') ?? '');
	let timer: ReturnType<typeof setTimeout> | undefined;

	function href(q: string, p: number) {
		const params = new URLSearchParams();
		if (q) params.set('q', q);
		if (p > 1) params.set('page', String(p));
		const s = params.toString();
		return s ? `?${s}` : page.url.pathname;
	}

	function onSearchInput() {
		clearTimeout(timer);
		timer = setTimeout(() => {
			void goto(href(search.trim(), 1), { reset: false, replace: true });
		}, 250);
	}

	function clearSearch() {
		search = '';
		clearTimeout(timer);
		void goto(href('', 1), { reset: false, replace: true });
	}

	const otherName = (l: { nameSv: string | null; nameEn: string | null }) => {
		const primary = localized(l, 'name', locale());
		const other = locale() === 'sv' ? l.nameEn : l.nameSv;
		return other && other !== primary ? other : null;
	};
</script>

<svelte:head><title>{t().locations} · {t().admin} · {c().appName}</title></svelte:head>

<PageHeader title={t().locations} subtitle={t().locationCount(result.total)}>
	{#snippet actions()}
		<Button href="/admin/locations/new">+ {t().newLocation}</Button>
	{/snippet}
</PageHeader>

<div class="toolbar">
	<label class="search">
		<span class="visually-hidden">{t().search}</span>
		<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2">
			<circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
		</svg>
		<input
			type="search"
			placeholder={t().searchLocations}
			bind:value={search}
			oninput={onSearchInput}
			onkeydown={(e) => e.key === 'Escape' && clearSearch()}
		/>
	</label>
	{#if $effect.pending()}<span class="spinner" aria-label={c().loading}></span>{/if}
</div>

{#if result.items.length === 0}
	{#if urlQuery}
		<EmptyState title={t().noSearchResults(urlQuery)}>
			<Button variant="secondary" onclick={clearSearch}>{t().clearSearch}</Button>
		</EmptyState>
	{:else}
		<EmptyState title={t().noLocations} hint={t().noLocationsHint}>
			<Button href="/admin/locations/new">+ {t().newLocation}</Button>
		</EmptyState>
	{/if}
{:else}
	<div class="table-wrap" class:stale={$effect.pending()}>
		<table>
			<thead>
				<tr>
					<th scope="col" class="thumb-col"><span class="visually-hidden">{t().photo}</span></th>
					<th scope="col">{t().colLocation}</th>
					<th scope="col">{t().colTranslations}</th>
					<th scope="col" class="num">{t().colPlaylists}</th>
					<th scope="col" class="date">{t().updated}</th>
				</tr>
			</thead>
			<tbody>
				{#each result.items as l (l.id)}
					{@const name = localized(l, 'name', locale()) || t().untitled}
					<tr>
						<td class="thumb-col"><Thumb fileKey={l.photo?.fileKey} label={t().textClue} /></td>
						<td class="name-col">
							<a class="row-link" href="/admin/locations/{l.id}">{name}</a>
							{#if otherName(l)}<span class="other muted">{otherName(l)}</span>{/if}
						</td>
						<td><MissingBadges missing={l.missing} showComplete /></td>
						<td class="num">
							{#if l.playlistCount > 0}{l.playlistCount}{:else}<Badge>0</Badge>{/if}
						</td>
						<td class="date muted">{formatDate(l.updatedAt, locale())}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if lastPage > 1}
		<nav class="pager" aria-label={t().locations}>
			<span class="muted">
				{t().rangeOf((pageNo - 1) * PAGE_SIZE + 1, Math.min(pageNo * PAGE_SIZE, result.total), result.total)}
			</span>
			<div class="u-row">
				<Button
					variant="secondary"
					size="sm"
					href={pageNo > 1 ? href(urlQuery, pageNo - 1) : undefined}
					disabled={pageNo <= 1}
					aria-disabled={pageNo <= 1}>← {t().previous}</Button
				>
				<Button
					variant="secondary"
					size="sm"
					href={pageNo < lastPage ? href(urlQuery, pageNo + 1) : undefined}
					disabled={pageNo >= lastPage}>{t().nextPage} →</Button
				>
			</div>
		</nav>
	{/if}
{/if}

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.search {
		flex: 1;
		max-width: 36rem;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-3);
		min-height: 2.75rem;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text-muted);
	}
	.search:focus-within {
		border-color: var(--color-primary);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		outline: none;
		background: none;
		font-size: max(1rem, 16px);
		color: var(--color-text);
	}
	.spinner {
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.table-wrap {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		transition: opacity var(--duration-fast);
	}
	.stale {
		opacity: 0.6;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: var(--space-2) var(--space-3);
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
		font-weight: var(--weight-bold);
		white-space: nowrap;
	}
	tbody tr {
		position: relative;
	}
	tbody tr:hover {
		background: var(--color-surface-2);
	}
	.thumb-col {
		width: 5rem;
		padding-right: 0;
	}
	.name-col {
		min-width: 12rem;
	}
	/* The whole row is clickable through the name link. */
	.row-link {
		font-weight: var(--weight-bold);
		color: var(--color-text);
		text-decoration: none;
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
	.pager {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}
	@media (max-width: 40rem) {
		.date,
		th.date,
		.num {
			display: none;
		}
		.name-col {
			min-width: 0;
		}
	}
</style>
