<!-- Cards for unfinished games, newest first, so the host can get back in after closing the tab. -->
<script lang="ts">
	import type { GameHistoryItem } from '#lib/game/types.ts';
	import { localized, type Locale } from '#lib/i18n/index.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';

	type Props = { games: GameHistoryItem[]; locale: Locale };
	let { games, locale }: Props = $props();

	const t = useT(host);
	const c = useT(common);
	const MAX = 4;

	const open = $derived(games.filter((g) => g.phase !== 'finished').slice(0, MAX));
	// Rendered on the server too; minute precision is plenty and avoids a hydration mismatch
	// for all but the minute boundary.
	const now = Date.now();
	const minutesAgo = (ms: number) => Math.max(0, Math.floor((now - ms) / 60_000));
</script>

{#if open.length > 0}
	<section class="resume" aria-labelledby="resume-title">
		<h2 id="resume-title" class="eyebrow">{t().continueGames}</h2>
		<ul>
			{#each open as g (g.id)}
				<li>
					<a class="card" href="/host/{g.id}" data-testid="resume-game">
						<span class="code">{g.joinCode}</span>
						<span class="body">
							<span class="name">
								{g.playlistName ? localized(g.playlistName, 'name', locale) || t().unnamedPlaylist : t().unnamedPlaylist}
							</span>
							<span class="meta">
								<span class={['phase', g.phase]}>{t()[`resumePhase_${g.phase}`]}</span>
								· {c().playerCount(g.playerCount)}
								{#if g.roundsPlayed > 0}· {t().roundsPlayed(g.roundsPlayed)}{/if}
								· {t().createdAgo(minutesAgo(g.createdAt))}
							</span>
						</span>
						<span class="chev" aria-hidden="true">›</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.resume {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.eyebrow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.card {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 4rem;
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		border: 2px solid transparent;
		color: var(--color-text);
		text-decoration: none;
		transition: border-color var(--duration-fast);
	}
	.card:hover {
		border-color: var(--color-primary);
	}
	.code {
		flex: none;
		font-family: var(--font-mono);
		font-weight: var(--weight-bold);
		font-size: var(--text-xl);
		letter-spacing: 0.1em;
		color: var(--color-primary);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-weight: var(--weight-bold);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.phase {
		font-weight: var(--weight-medium);
	}
	.phase.round,
	.phase.reveal,
	.phase.standings {
		color: var(--color-success);
	}
	.chev {
		flex: none;
		font-size: var(--text-2xl);
		color: var(--color-text-muted);
	}
</style>
