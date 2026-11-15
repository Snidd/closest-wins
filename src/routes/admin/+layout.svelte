<!-- Admin shell: sidebar navigation on desktop, compact top bar on phones. -->
<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { navState } from './_components/fresh.svelte.ts';
	import { logout } from '#lib/remote/auth.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import ErrorPanel from './_components/ErrorPanel.svelte';

	let { children } = $props();
	const t = useT(admin);
	const c = useT(common);

	beforeNavigate(() => {
		navState.client = true;
	});

	const nav = $derived([
		{ href: '/admin', label: t().dashboard, exact: true },
		{ href: '/admin/locations', label: t().locations },
		{ href: '/admin/playlists', label: t().playlists },
		{ href: '/admin/games', label: t().games }
	]);

	const isActive = (href: string, exact = false) =>
		exact ? page.url.pathname === href : page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
</script>

<div class="shell">
	<div class="side">
		<header class="bar">
			<a class="brand" href="/admin">
				<span class="logo" aria-hidden="true">◎</span>
				<span class="brand-text">{c().appName}</span>
				<span class="tag">{t().admin}</span>
			</a>
			<nav aria-label={t().mainNav}>
				<ul>
					{#each nav as item (item.href)}
						<li>
							<a
								href={item.href}
								class:active={isActive(item.href, item.exact)}
								aria-current={isActive(item.href, item.exact) ? 'page' : undefined}>{item.label}</a
							>
						</li>
					{/each}
				</ul>
			</nav>
			<div class="bar-end">
				<a class="host-link" href="/host">{t().hostAGame}</a>
				<form {...logout}>
					<button class="logout" type="submit">{c().logout}</button>
				</form>
			</div>
		</header>
	</div>

	<main class="content">
		<svelte:boundary>
			{@render children()}

			{#snippet pending()}
				<p class="muted loading">{c().loading}</p>
			{/snippet}
			{#snippet failed(error, reset)}
				<ErrorPanel message={t().loadFailed} detail={(error as { message?: string })?.message} onretry={reset} />
			{/snippet}
		</svelte:boundary>
	</main>
</div>

<style>
	.shell {
		min-height: 100dvh;
		display: grid;
		grid-template-columns: 14rem minmax(0, 1fr);
	}
	.side {
		background: var(--color-surface);
		border-right: 1px solid var(--color-border);
	}
	.bar {
		position: sticky;
		top: 0;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-5) var(--space-3);
	}
	.brand {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		padding: 0 var(--space-2);
		color: var(--color-text);
		text-decoration: none;
		font-weight: var(--weight-bold);
	}
	.logo {
		font-size: var(--text-xl);
		color: var(--color-primary);
		line-height: 1;
	}
	.brand-text {
		white-space: nowrap;
	}
	.tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		padding: 0.1rem 0.4rem;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	nav a {
		display: block;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--color-text);
		text-decoration: none;
		font-weight: var(--weight-medium);
	}
	nav a:hover {
		background: var(--color-surface-2);
	}
	nav a.active {
		background: color-mix(in srgb, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
	}
	.bar-end {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.host-link,
	.logout {
		display: block;
		width: 100%;
		text-align: left;
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius-md);
		background: none;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		text-decoration: none;
		cursor: pointer;
	}
	.host-link:hover,
	.logout:hover {
		background: var(--color-surface-2);
		color: var(--color-text);
	}
	.content {
		min-width: 0;
		padding: var(--space-6) var(--space-6) var(--space-7);
		max-width: 80rem;
		width: 100%;
	}
	.loading {
		padding: var(--space-6) 0;
	}
	/* Destructive text buttons in page headers. */
	.content :global(.btn.ghost.danger-link) {
		color: var(--color-danger);
	}

	@media (max-width: 52rem) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto 1fr;
		}
		.side {
			position: sticky;
			top: 0;
			z-index: 10;
			border-right: 0;
			border-bottom: 1px solid var(--color-border);
		}
		.bar {
			position: static;
			height: auto;
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2) var(--space-3);
			padding: calc(var(--space-2) + var(--safe-top)) var(--space-3) var(--space-2);
		}
		.brand {
			padding: 0;
		}
		.bar-end {
			margin: 0 0 0 auto;
			flex-direction: row;
		}
		.host-link {
			display: none;
		}
		nav {
			order: 3;
			width: 100%;
			overflow-x: auto;
			scrollbar-width: none;
		}
		nav ul {
			flex-direction: row;
		}
		nav a {
			white-space: nowrap;
			padding: var(--space-1) var(--space-3);
		}
		.content {
			padding: var(--space-4) var(--space-4) var(--space-7);
		}
	}
</style>
