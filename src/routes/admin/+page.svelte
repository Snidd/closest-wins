<!-- Admin dashboard: counts and shortcuts. -->
<script lang="ts">
	import { listLocations, listPlaylists } from '#lib/remote/content.remote.ts';
	import { listGames } from '#lib/remote/game.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import PageHeader from './_components/PageHeader.svelte';
	import { fresh } from './_components/fresh.svelte.ts';

	const t = useT(admin);
	const c = useT(common);

	const locationsQuery = fresh(() => listLocations({ limit: 1 }));
	const playlistsQuery = fresh(() => listPlaylists());
	const gamesQuery = fresh(() => listGames({ limit: 200 }));
	const [locations, playlists] = $derived(await Promise.all([locationsQuery(), playlistsQuery()]));
	const missing = $derived(playlists.reduce((sum, p) => sum + p.missingTranslationCount, 0));
</script>

<svelte:head><title>{t().dashboard} · {t().admin} · {c().appName}</title></svelte:head>

<PageHeader title={t().dashboard} subtitle={t().dashboardIntro} />

<div class="cards">
	<a class="card" href="/admin/locations">
		<span class="label">{t().locations}</span>
		<span class="big">{locations.total}</span>
		<span class="muted">{t().locationCount(locations.total)}</span>
	</a>
	<a class="card" href="/admin/playlists">
		<span class="label">{t().playlists}</span>
		<span class="big">{playlists.length}</span>
		{#if missing > 0}
			<span class="warn">{t().needsTranslation(missing)}</span>
		{:else}
			<span class="muted">{t().playlistCountLabel(playlists.length)}</span>
		{/if}
	</a>
	<a class="card" href="/admin/games">
		<span class="label">{t().games}</span>
		<svelte:boundary>
			{@const games = await gamesQuery()}
			<span class="big">{games.length}{games.length === 200 ? '+' : ''}</span>
			<span class="muted">{t().gameCountLabel(games.length)}</span>
			{#snippet pending()}
				<span class="big muted">…</span>
			{/snippet}
			{#snippet failed()}
				<span class="big muted">–</span>
				<span class="muted">{t().gamesUnavailable}</span>
			{/snippet}
		</svelte:boundary>
	</a>
</div>

<div class="u-row actions">
	<Button href="/admin/locations/new">+ {t().newLocation}</Button>
	<Button href="/admin/playlists/new" variant="secondary">+ {t().newPlaylist}</Button>
</div>

<style>
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-height: 9rem;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		text-decoration: none;
		transition:
			border-color var(--duration-fast),
			box-shadow var(--duration-fast);
	}
	.card:hover {
		border-color: var(--color-primary);
		box-shadow: var(--shadow-sm);
	}
	.label {
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.big {
		font-size: var(--text-4xl);
		font-weight: var(--weight-bold);
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.warn {
		color: var(--color-warning);
		font-weight: var(--weight-medium);
	}
	.actions {
		gap: var(--space-2);
	}
</style>
