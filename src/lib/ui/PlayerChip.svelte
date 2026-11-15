<!-- Nickname with the player's pin colour; greyed out when disconnected. -->
<script lang="ts">
	import { textColorOn } from './colors.ts';

	type Props = {
		nickname: string;
		color: string;
		connected?: boolean;
		/** Show a lock/check badge (locked in this round). */
		locked?: boolean;
		/** Highlight as round/game winner. */
		winner?: boolean;
		/** Filled pill in the player's colour instead of a dot + name. */
		filled?: boolean;
		size?: 'sm' | 'md' | 'lg';
		/** Accessible text for the disconnected state, e.g. t().disconnected. */
		disconnectedLabel?: string;
	};

	let {
		nickname,
		color,
		connected = true,
		locked = false,
		winner = false,
		filled = false,
		size = 'md',
		disconnectedLabel = 'Disconnected'
	}: Props = $props();
</script>

<span
	class={['chip', size, { filled, offline: !connected, winner }]}
	style:--chip-color={color}
	style:--chip-text={filled ? textColorOn(color) : undefined}
	title={connected ? nickname : `${nickname} (${disconnectedLabel})`}
>
	{#if !filled}<span class="dot" aria-hidden="true"></span>{/if}
	<span class="name">{nickname}</span>
	{#if locked}<span class="badge" aria-hidden="true">✓</span>{/if}
	{#if !connected}<span class="visually-hidden">({disconnectedLabel})</span>{/if}
</span>

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.4em;
		max-width: 100%;
		padding: 0.25em 0.7em 0.25em 0.5em;
		border-radius: var(--radius-pill);
		background: var(--color-surface-2);
		font-weight: var(--weight-medium);
		line-height: 1.2;
		transition:
			opacity var(--duration-normal),
			filter var(--duration-normal);
	}
	.filled {
		background: var(--chip-color);
		color: var(--chip-text);
		padding-left: 0.7em;
	}
	.dot {
		flex: none;
		width: 0.85em;
		height: 0.85em;
		border-radius: 50%;
		background: var(--chip-color);
		box-shadow: 0 0 0 2px var(--color-surface);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		font-size: 0.85em;
		color: var(--color-success);
	}
	.filled .badge {
		color: inherit;
	}
	.offline {
		opacity: 0.45;
		filter: grayscale(1);
	}
	.winner {
		box-shadow: 0 0 0 3px var(--color-accent);
	}
	.sm {
		font-size: var(--text-sm);
	}
	.md {
		font-size: var(--text-md);
	}
	.lg {
		font-size: var(--text-xl);
	}
</style>
