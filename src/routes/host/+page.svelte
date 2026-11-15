<!--
  Host home (`/host`): get back into an unfinished game, or create a new one. Phone first; the
  create form is built so that "pick a playlist → Create game" is two taps (every option has a
  sensible default from the playlist and the phone's locale).
-->
<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { listPlaylists } from '#lib/remote/content.remote.ts';
	import { listGames } from '#lib/remote/game.remote.ts';
	import { logout } from '#lib/remote/auth.remote.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import mark from '#lib/assets/favicon.svg';
	import CreateGameForm from './CreateGameForm.svelte';
	import ResumeGames from './ResumeGames.svelte';

	const t = useT(host);
	const c = useT(common);
	const locale = useLocale();

	const playlistsQuery = listPlaylists();
	const gamesQuery = listGames({ limit: 50 });
	const playlists = $derived(await playlistsQuery);

	// Coming back from a game (client-side navigation): the cached lists may be stale.
	afterNavigate(({ from }) => {
		if (!from) return;
		void gamesQuery.refresh();
		void playlistsQuery.refresh();
	});
</script>

<svelte:head>
	<title>{t().newGame} · {c().appName}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="home">
	<header class="top">
		<a class="brand" href="/">
			<img src={mark} alt="" width="28" height="28" />
			<span>{c().appName}</span>
			<span class="tag">{t().hostTag}</span>
		</a>
		<form {...logout}>
			<button class="logout" type="submit">{c().logout}</button>
		</form>
	</header>

	<svelte:boundary>
		<ResumeGames games={await gamesQuery} locale={locale()} />
		{#snippet failed()}{/snippet}
	</svelte:boundary>

	{#if playlists.length === 0}
		<section class="empty" data-testid="no-playlists">
			<div class="empty-icon" aria-hidden="true">
				<svg viewBox="0 0 48 48"
					><rect x="9" y="8" width="30" height="34" rx="4" /><path d="M16 18h16M16 25h16M16 32h9" /></svg
				>
			</div>
			<h1>{t().noPlaylistsTitle}</h1>
			<p class="muted">{t().noPlaylistsBody}</p>
			<a class="admin-btn" href="/admin/playlists">{t().goToAdmin}</a>
		</section>
	{:else}
		<CreateGameForm {playlists} />
		<a class="manage" href="/admin">{t().manageContent} →</a>
	{/if}
</div>

<style>
	.home {
		max-width: 34rem;
		margin-inline: auto;
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: calc(var(--space-3) + var(--safe-top)) calc(var(--space-4) + var(--safe-right)) 0
			calc(var(--space-4) + var(--safe-left));
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--tap-target);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}
	.brand img {
		border-radius: 0.4rem;
	}
	.tag {
		padding: 0.1em 0.55em;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.logout {
		min-height: var(--tap-target);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.logout:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		margin-block: var(--space-7) auto;
	}
	.empty h1 {
		font-size: var(--text-2xl);
	}
	.empty .muted {
		max-width: 22rem;
		text-wrap: pretty;
	}
	.empty-icon {
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}
	.empty-icon svg {
		width: 2.5rem;
		height: 2.5rem;
		fill: none;
		stroke: var(--color-text-muted);
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.admin-btn {
		display: inline-flex;
		align-items: center;
		min-height: 3.5rem;
		padding: 0 var(--space-6);
		margin-top: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--color-primary);
		color: var(--color-primary-contrast);
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		text-decoration: none;
	}
	.manage {
		align-self: center;
		margin-bottom: var(--space-4);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-underline-offset: 0.2em;
	}
</style>
