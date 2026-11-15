<!-- One game's result: summary, standings and every round with its guesses. -->
<script lang="ts">
	import { getGameHistory } from '#lib/remote/game.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import PageHeader from '../../_components/PageHeader.svelte';
	import ErrorPanel from '../../_components/ErrorPanel.svelte';
	import EmptyState from '../../_components/EmptyState.svelte';
	import GameDetail from './GameDetail.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const t = useT(admin);
	const c = useT(common);

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	const status = (e: unknown) => (e as { status?: number })?.status;
	const message = (e: unknown) =>
		(e as { body?: { message?: string } })?.body?.message ?? (e as { message?: string })?.message;
</script>

<svelte:head><title>{t().gameHistory} · {t().admin} · {c().appName}</title></svelte:head>

{#if !UUID.test(params.gameId)}
	<EmptyState title={t().notFoundGame}>
		<Button href="/admin/games" variant="secondary">← {t().games}</Button>
	</EmptyState>
{:else}
	<svelte:boundary>
		<GameDetail game={await getGameHistory(params.gameId)} />

		{#snippet pending()}<p class="muted">{c().loading}</p>{/snippet}
		{#snippet failed(error, reset)}
			<PageHeader title={t().gameHistory} back={{ href: '/admin/games', label: t().games }} />
			{#if status(error) === 404}
				<EmptyState title={t().notFoundGame}>
					<Button href="/admin/games" variant="secondary">← {t().games}</Button>
				</EmptyState>
			{:else}
				<ErrorPanel message={t().historyUnavailable} hint={t().historyUnavailableHint} detail={message(error)} onretry={reset} />
			{/if}
		{/snippet}
	</svelte:boundary>
{/if}
