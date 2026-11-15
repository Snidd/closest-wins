<!-- Player rows with a two-step "Remove" (kick). Offline players are greyed out. -->
<script lang="ts">
	import type { PlayerSummary } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';

	type Props = {
		players: PlayerSummary[];
		kicking: ReadonlySet<string>;
		onkick: (playerId: string) => void;
	};
	let { players, kicking, onkick }: Props = $props();

	const t = useT(host);
	const c = useT(common);
	let confirming = $state<string | null>(null);

	// A player who left (or was removed) cannot stay "being confirmed".
	$effect(() => {
		if (confirming && !players.some((p) => p.id === confirming)) confirming = null;
	});
</script>

<ul class="players" data-testid="player-list">
	{#each players as p (p.id)}
		{@const busy = kicking.has(p.id)}
		<li class={['prow', { offline: !p.connected, confirming: confirming === p.id }]} data-testid="player-row" data-player={p.nickname}>
			<div class="main">
				<span class="dot" style:background={p.color} aria-hidden="true"></span>
				<span class="name">{p.nickname}</span>
				{#if !p.connected}<span class="tag">{c().disconnected}</span>{/if}
				{#if confirming !== p.id}
					<button
						type="button"
						class="kick"
						aria-label={t().kickPlayer(p.nickname)}
						disabled={busy}
						onclick={() => (confirming = p.id)}
					>
						{busy ? t().kicking : t().kick}
					</button>
				{/if}
			</div>
			{#if confirming === p.id}
				<div class="confirm" role="group" aria-label={t().kickConfirm(p.nickname)}>
					<p class="q">{t().kickConfirm(p.nickname)}</p>
					<p class="hint">{t().kickHint}</p>
					<div class="actions">
						<button type="button" class="no" onclick={() => (confirming = null)}>{t().cancel}</button>
						<button
							type="button"
							class="yes"
							disabled={busy}
							onclick={() => {
								confirming = null;
								onkick(p.id);
							}}>{t().kickConfirmYes}</button
						>
					</div>
				</div>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.players {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
	}
	.prow {
		border-top: 1px solid var(--color-border);
	}
	.prow:first-child {
		border-top: 0;
	}
	.main {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: 3.25rem;
	}
	.dot {
		flex: none;
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 3px var(--color-border);
	}
	.name {
		flex: 1;
		min-width: 0;
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.offline .dot,
	.offline .name {
		opacity: 0.45;
		filter: grayscale(1);
	}
	.tag {
		flex: none;
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.kick {
		flex: none;
		min-height: 2.5rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-pill);
		background: transparent;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.kick:hover:not(:disabled) {
		color: var(--color-danger);
		border-color: var(--color-danger);
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3);
		margin-bottom: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--color-danger) 10%, var(--color-surface));
	}
	.q {
		font-weight: var(--weight-bold);
	}
	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.actions button {
		min-height: 2.75rem;
		padding: 0 var(--space-4);
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
</style>
