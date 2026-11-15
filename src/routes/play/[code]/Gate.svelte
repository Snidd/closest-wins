<!--
  Dead ends and transitions outside a game: no game, kicked (final), redirecting to the join
  page, and the stream failing outright (retries by itself every few seconds).
-->
<script lang="ts">
	import { useT } from '#lib/i18n/context.ts';
	import { player } from '#lib/i18n/player.ts';
	import Button from '#lib/ui/Button.svelte';
	import Shell from './Shell.svelte';

	type Props = {
		kind: 'noGame' | 'kicked' | 'redirecting' | 'error';
		code: string;
		onretry?: () => Promise<void> | void;
	};
	let { kind, code, onretry }: Props = $props();
	const t = useT(player);

	let retrying = $state(false);
	async function retry() {
		if (retrying || !onretry) return;
		retrying = true;
		try {
			await onretry();
		} finally {
			retrying = false;
		}
	}

	$effect(() => {
		if (kind !== 'error') return;
		const id = setInterval(() => {
			if (document.visibilityState === 'visible') void retry();
		}, 5000);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void retry();
		};
		window.addEventListener('online', onVisible);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(id);
			window.removeEventListener('online', onVisible);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
</script>

<Shell center testid="gate-{kind}">
	<section class="gate" data-kind={kind}>
		<div class={['icon', kind]} aria-hidden="true">
			{#if kind === 'kicked'}
				<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" /><path d="M16 16l16 16M32 16L16 32" /></svg>
			{:else if kind === 'error'}
				<svg viewBox="0 0 48 48"
					><path d="M6 19a26 26 0 0 1 36 0M12 26a17 17 0 0 1 24 0M18 33a8 8 0 0 1 12 0" /><circle
						cx="24"
						cy="39"
						r="1.5"
					/></svg
				>
			{:else if kind === 'redirecting'}
				<span class="spinner"></span>
			{:else}
				<svg viewBox="0 0 48 48"
					><circle cx="24" cy="24" r="16" /><path d="M24 4v8M24 36v8M4 24h8M36 24h8" /><path
						class="q"
						d="M20 20.5a4 4 0 1 1 5.5 3.7c-1 .5-1.5 1.2-1.5 2.3v1M24 31.5v.5"
					/></svg
				>
			{/if}
		</div>

		{#if kind === 'noGame'}
			<h1>{t().noGameTitle}</h1>
			<p class="muted">{t().noGameBody(code)}</p>
			<Button href="/" size="lg" block>{t().joinAnother}</Button>
		{:else if kind === 'kicked'}
			<h1>{t().kickedTitle}</h1>
			<p class="muted">{t().kickedBody}</p>
			<Button href="/" size="lg" block variant="secondary">{t().backToStart}</Button>
		{:else if kind === 'redirecting'}
			<p class="muted">{t().redirecting}</p>
		{:else}
			<h1>{t().errorTitle}</h1>
			<p class="muted">{t().errorBody}</p>
			<Button size="lg" block busy={retrying} onclick={retry}>{t().tryAgain}</Button>
		{/if}
	</section>
</Shell>

<style>
	.gate {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
		padding-bottom: var(--space-7);
	}
	h1 {
		font-size: clamp(1.6rem, 7vw, 2rem);
		text-wrap: balance;
	}
	.muted {
		max-width: 22rem;
		text-wrap: pretty;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 5rem;
		height: 5rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
	}
	.icon svg {
		width: 3rem;
		height: 3rem;
		fill: none;
		stroke: var(--color-text-muted);
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.icon.kicked svg {
		stroke: var(--color-danger);
	}
	.icon .q {
		stroke: var(--color-accent);
		stroke-width: 3;
	}
	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--color-primary);
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}
</style>
