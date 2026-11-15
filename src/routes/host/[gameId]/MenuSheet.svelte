<!--
  The tucked-away actions, as a bottom sheet: TV status / re-pairing, players with "Remove", and
  "End game now" (two-step). Content only renders while open.
-->
<script lang="ts">
	import type { HostSnapshot } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { host } from '#lib/i18n/host.ts';
	import PairTv from './PairTv.svelte';
	import PlayerList from './PlayerList.svelte';
	import TvStatus from './TvStatus.svelte';

	type Props = {
		open: boolean;
		snap: HostSnapshot;
		tvUrl: string;
		kicking: ReadonlySet<string>;
		onkick: (playerId: string) => void;
		onendgame: () => void;
		endPending: boolean;
	};
	let { open = $bindable(), snap, tvUrl, kicking, onkick, onendgame, endPending }: Props = $props();

	const t = useT(host);
	let dialog = $state<HTMLDialogElement | null>(null);
	let confirmEnd = $state(false);
	let repair = $state(false);

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
	$effect(() => {
		if (!open) {
			confirmEnd = false;
			repair = false;
		}
	});

	const canPair = $derived(snap.phase !== 'lobby' && snap.phase !== 'finished');
	const finished = $derived(snap.phase === 'finished');
</script>

<dialog
	bind:this={dialog}
	class="sheet"
	aria-labelledby="menu-title"
	onclose={() => (open = false)}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
	data-testid="game-menu"
>
	{#if open}
		<div class="inner">
			<header class="head">
				<h2 id="menu-title">{t().menu}</h2>
				<button type="button" class="close" aria-label={t().close} onclick={() => (open = false)}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
				</button>
			</header>

			<section class="sec" aria-labelledby="menu-tv">
				<h3 id="menu-tv" class="eyebrow">{t().tvTitle}</h3>
				{#if canPair && (repair || !snap.tv.paired)}
					<PairTv
						gameId={snap.game.id}
						{tvUrl}
						onpaired={() => (repair = false)}
						oncancel={snap.tv.paired ? () => (repair = false) : undefined}
					/>
				{:else}
					<TvStatus tv={snap.tv} />
					{#if canPair}
						<button type="button" class="link" onclick={() => (repair = true)}>{t().pairAnother}</button>
					{/if}
				{/if}
			</section>

			<section class="sec" aria-labelledby="menu-players">
				<h3 id="menu-players" class="eyebrow">{t().playersTitle} · {snap.players.length}</h3>
				{#if snap.players.length === 0}
					<p class="muted">{t().noPlayers}</p>
				{:else if finished}
					<p class="muted">{snap.players.map((p) => p.nickname).join(', ')}</p>
				{:else}
					<PlayerList players={snap.players} {kicking} {onkick} />
				{/if}
			</section>

			{#if !finished}
				<section class="sec danger" aria-labelledby="menu-end">
					<h3 id="menu-end" class="eyebrow">{t().dangerZone}</h3>
					{#if !confirmEnd}
						<button type="button" class="end" onclick={() => (confirmEnd = true)} data-testid="end-game">
							{t().endGameNow}
						</button>
					{:else}
						<div class="confirm" role="group" aria-labelledby="end-q">
							<p id="end-q" class="q">{t().endGameConfirm}</p>
							<p class="explain">{t().endGameExplain}</p>
							<div class="actions">
								<button type="button" class="no" onclick={() => (confirmEnd = false)}>{t().cancel}</button>
								<button type="button" class="yes" disabled={endPending} onclick={onendgame} data-testid="end-game-confirm">
									{endPending ? t().ending2 : t().endGameYes}
								</button>
							</div>
						</div>
					{/if}
				</section>
			{/if}

			<a class="all" href="/host">← {t().allGames}</a>
		</div>
	{/if}
</dialog>

<style>
	.sheet {
		width: 100%;
		max-width: 34rem;
		max-height: min(92dvh, 52rem);
		margin: auto auto 0;
		padding: 0;
		border: 0;
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		background: var(--color-bg);
		color: var(--color-text);
		box-shadow: var(--shadow-lg);
		overscroll-behavior: contain;
	}
	.sheet[open] {
		animation: up var(--duration-normal) var(--ease-out);
	}
	.sheet::backdrop {
		background: var(--color-overlay);
	}
	@keyframes up {
		from {
			transform: translateY(2rem);
			opacity: 0;
		}
	}
	@media (min-width: 40rem) {
		.sheet {
			margin: auto;
			border-radius: var(--radius-lg);
		}
	}
	.inner {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-3) calc(var(--space-4) + var(--safe-right)) calc(var(--space-5) + var(--safe-bottom))
			calc(var(--space-4) + var(--safe-left));
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.head h2 {
		font-size: var(--text-xl);
	}
	.close {
		display: grid;
		place-items: center;
		width: var(--tap-target);
		height: var(--tap-target);
		margin-right: calc(-1 * var(--space-2));
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}
	.close:hover {
		background: var(--color-surface-2);
	}
	.close svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.sec {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}
	.eyebrow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-text-muted);
	}
	.link {
		align-self: flex-start;
		min-height: 2.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-primary);
		font-weight: var(--weight-medium);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
	.danger {
		border: 1px solid color-mix(in oklab, var(--color-danger) 40%, transparent);
	}
	.end {
		min-height: 3rem;
		border: 2px solid var(--color-danger);
		border-radius: var(--radius-md);
		background: transparent;
		color: var(--color-danger);
		font-weight: var(--weight-bold);
		cursor: pointer;
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.q {
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
	}
	.explain {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.actions button {
		flex: 1;
		min-height: 3rem;
		border-radius: var(--radius-md);
		font-weight: var(--weight-bold);
		cursor: pointer;
	}
	.no {
		border: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.yes {
		border: 0;
		background: var(--color-danger);
		color: var(--color-danger-contrast);
	}
	.yes:disabled {
		opacity: 0.6;
	}
	.all {
		align-self: center;
		min-height: var(--tap-target);
		display: inline-flex;
		align-items: center;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
