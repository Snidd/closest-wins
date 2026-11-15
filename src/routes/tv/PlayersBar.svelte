<!--
  The row of players during a round: who has locked in (bright, check), who is still thinking
  (muted) and who is disconnected (grey). In sudden death the duellists are shown big and the
  rest as a small "watching" group. Sizes step down with the number of players (fits 40).
-->
<script lang="ts">
	import type { PlayerSummary } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { tv as tvDict } from '#lib/i18n/tv.ts';
	import Avatar from './Avatar.svelte';

	type Props = {
		players: PlayerSummary[];
		lockedIds: string[];
		/** null = everyone plays. */
		eligibleIds: string[] | null;
	};
	let { players, lockedIds, eligibleIds }: Props = $props();
	const t = useT(tvDict);

	const locked = $derived(new Set(lockedIds));
	const playing = $derived(eligibleIds ? players.filter((p) => eligibleIds.includes(p.id)) : players);
	const watching = $derived(eligibleIds ? players.filter((p) => !eligibleIds.includes(p.id)) : []);
	const lockedCount = $derived(playing.filter((p) => locked.has(p.id)).length);
	const n = $derived(playing.length);
	const tier = $derived(eligibleIds ? 'duel' : n <= 8 ? 'xl' : n <= 14 ? 'lg' : n <= 24 ? 'md' : 'sm');
</script>

<div class="bar" data-testid="players-bar">
	<div class="tally" data-testid="locked-count" data-locked={lockedCount} data-total={n}>
		<span class="frac"><b>{lockedCount}</b><span class="slash">/</span>{n}</span>
		<span class="cap">{t().lockedInCap}</span>
	</div>
	<ul class={['chips', tier]}>
		{#each playing as p (p.id)}
			{@const isLocked = locked.has(p.id)}
			<li
				class={['chip', { locked: isLocked, offline: !p.connected }]}
				data-testid="round-player"
				data-player-id={p.id}
				data-locked={isLocked}
				data-connected={p.connected}
				title={p.connected ? p.nickname : `${p.nickname} (${t().disconnected})`}
			>
				<span class="av">
					<Avatar nickname={p.nickname} color={p.color} size="1.75em" offline={!p.connected} />
					{#if isLocked}
						<span class="check" aria-hidden="true"
							><svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3L13 4.8" /></svg></span
						>
					{:else if !p.connected}
						<span class="plug" aria-hidden="true"
							><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></svg></span
						>
					{/if}
				</span>
				<span class="name">{p.nickname}</span>
			</li>
		{/each}
	</ul>
	{#if watching.length}
		<div class="watching" data-testid="watching">
			<span class="wl">{t().watching}</span>
			<span class="faces">
				{#each watching.slice(0, 18) as p (p.id)}
					<Avatar nickname={p.nickname} color={p.color} size="1.5em" offline={!p.connected} />
				{/each}
				{#if watching.length > 18}<span class="more">+{watching.length - 18}</span>{/if}
			</span>
		</div>
	{/if}
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 1.4rem;
		min-width: 0;
		padding: 0.7rem 1.1rem;
		border-radius: 1.3rem;
		background: var(--tv-glass);
		border: 1px solid var(--tv-line);
		backdrop-filter: blur(10px);
	}
	.tally {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: none;
		min-width: 5rem;
		line-height: 1;
	}
	.frac {
		font-size: 2rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: var(--tv-ink-2);
	}
	.frac b {
		color: var(--tv-ink);
		font-weight: 900;
	}
	.slash {
		margin: 0 0.08em;
		opacity: 0.5;
	}
	.cap {
		margin-top: 0.3rem;
		font-size: 0.8rem;
		font-weight: 750;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--tv-ink-3);
		white-space: nowrap;
	}

	.chips {
		flex: 1;
		min-width: 0;
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--gap);
		align-content: center;
	}
	.xl {
		font-size: 1.3rem;
		--gap: 0.6rem 0.8rem;
	}
	.lg {
		font-size: 1.05rem;
		--gap: 0.5rem 0.6rem;
	}
	.md {
		font-size: 0.92rem;
		--gap: 0.4rem 0.5rem;
	}
	.sm {
		font-size: 0.8rem;
		--gap: 0.3rem 0.35rem;
	}
	.duel {
		font-size: 1.6rem;
		--gap: 0.8rem 1.2rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		max-width: 11em;
		padding: 0.18em 0.75em 0.18em 0.2em;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.06);
		border: 1px solid transparent;
		opacity: 0.72;
		transition:
			opacity 400ms,
			background 400ms,
			border-color 400ms;
	}
	.sm .chip {
		max-width: 8.5em;
		padding-right: 0.55em;
	}
	.chip.locked {
		opacity: 1;
		background: rgb(61 220 132 / 0.14);
		border-color: rgb(61 220 132 / 0.55);
		animation: lock-pop 650ms cubic-bezier(0.3, 1.7, 0.5, 1);
	}
	.chip.offline {
		opacity: 0.45;
		background: transparent;
		border-color: rgb(255 255 255 / 0.12);
		border-style: dashed;
	}
	.av {
		position: relative;
		display: inline-flex;
	}
	.check,
	.plug {
		position: absolute;
		right: -0.25em;
		bottom: -0.2em;
		display: grid;
		place-items: center;
		width: 0.95em;
		height: 0.95em;
		border-radius: 50%;
		background: #3ddc84;
		box-shadow: 0 0 0 0.12em var(--tv-bg-1);
	}
	.plug {
		background: #6b778c;
	}
	.check svg,
	.plug svg {
		width: 70%;
		height: 70%;
		fill: none;
		stroke: #06210f;
		stroke-width: 2.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.plug svg {
		stroke: #e9eef5;
	}
	.name {
		font-weight: 700;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.offline .name {
		text-decoration: line-through;
		text-decoration-color: rgb(255 255 255 / 0.3);
	}

	.watching {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.3rem;
		flex: none;
		max-width: 30%;
		opacity: 0.75;
	}
	.wl {
		font-size: 0.8rem;
		font-weight: 750;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--tv-ink-3);
	}
	.faces {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	.more {
		align-self: center;
		font-weight: 700;
		color: var(--tv-ink-3);
	}
	@keyframes lock-pop {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.12);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
