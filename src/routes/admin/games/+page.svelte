<!-- Game history list (from the engine's `listGames`). -->
<script lang="ts">
	import { page } from '$app/state';
	import { listGames } from '#lib/remote/game.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import PageHeader from '../_components/PageHeader.svelte';
	import ErrorPanel from '../_components/ErrorPanel.svelte';
	import GamesTable from './GamesTable.svelte';

	const t = useT(admin);
	const c = useT(common);
	const PAGE_SIZE = 50;
	const pageNo = $derived(Math.max(1, Number(page.url.searchParams.get('page')) || 1));
</script>

<svelte:head><title>{t().games} · {t().admin} · {c().appName}</title></svelte:head>

<PageHeader title={t().gameHistory}>
	{#snippet actions()}
		<Button href="/host" variant="secondary">{t().hostAGame}</Button>
	{/snippet}
</PageHeader>

<svelte:boundary>
	<GamesTable games={await listGames({ limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE })} {pageNo} pageSize={PAGE_SIZE} />

	{#snippet pending()}<p class="muted">{c().loading}</p>{/snippet}
	{#snippet failed(error, reset)}
		<ErrorPanel
			message={t().historyUnavailable}
			hint={t().historyUnavailableHint}
			detail={(error as { message?: string; body?: { message?: string } })?.body?.message ??
				(error as { message?: string })?.message}
			onretry={reset}
		/>
	{/snippet}
</svelte:boundary>
