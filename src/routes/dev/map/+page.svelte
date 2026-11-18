<!--
  Map playground (dev aid, no auth): exercise GuessMap, RevealMap (3 / 12 / 40 fake players,
  replay, skip, final mode) and StaticPointMap. URL params: ?view=guess|reveal|static,
  &n=3|12|40, &target=stockholm|fiji|machuPicchu|uluru, &theme=light|dark, &final=1,
  &cluster=1 (three guesses within 10 km of the target, the rest far away),
  guess view: &lat=..&lng=..&z=.. (initial centre / zoom).
-->
<script lang="ts">
	import { page } from '$app/state';
	import GuessMap, { type GuessState } from '#lib/map/GuessMap.svelte';
	import RevealMap from '#lib/map/RevealMap.svelte';
	import StaticPointMap from '#lib/map/StaticPointMap.svelte';
	import type { RevealStage } from '#lib/map/reveal.ts';
	import { fakePlayers, fakeResult, TARGETS, type TargetKey } from './fake.ts';

	type View = 'guess' | 'reveal' | 'static';
	const params = page.url.searchParams;
	let view = $state<View>((['guess', 'reveal', 'static'] as const).find((v) => v === params.get('view')) ?? 'guess');
	let themeChoice = $state<'auto' | 'light' | 'dark'>(
		params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : 'auto'
	);

	$effect(() => {
		const html = document.documentElement;
		if (themeChoice === 'auto') delete html.dataset.theme;
		else html.dataset.theme = themeChoice;
	});

	// ---- Guess ----
	const initLat = Number(params.get('lat'));
	const initLng = Number(params.get('lng'));
	const initialCenter = params.has('lat') && params.has('lng') ? { lat: initLat, lng: initLng } : null;
	const initialZoom = params.has('z') ? Number(params.get('z')) : undefined;
	let guessMap = $state<GuessMap>();
	let touched = $state(false);
	let locked = $state(false);
	let last = $state<GuessState | null>(null);
	let changes = $state(0);
	let lockedAt = $state<GuessState | null>(null);

	function lockIn() {
		if (!guessMap) return;
		lockedAt = guessMap.getGuess();
		locked = true;
	}

	// ---- Reveal ----
	let n = $state(Number(params.get('n')) || 12);
	let target = $state<TargetKey>((Object.keys(TARGETS) as TargetKey[]).find((k) => k === params.get('target')) ?? 'stockholm');
	let final = $state(params.get('final') === '1');
	let cluster = $state(params.get('cluster') === '1');
	let seed = $state(7);
	let startedAt = $state(Date.now());
	let skipped = $state(false);
	let stage = $state<RevealStage | null>(null);
	const players = $derived(fakePlayers(n));
	const result = $derived(fakeResult(players, target, startedAt, { seed, skipped, cluster }));

	function replay() {
		skipped = false;
		startedAt = Date.now();
	}

	// ---- Static ----
	let pLat = $state<number | null>(59.33);
	let pLng = $state<number | null>(18.07);
	let picks = $state(0);
</script>

<svelte:head><title>Map playground</title></svelte:head>

<div class="pg">
	<nav class="tabs">
		{#each ['guess', 'reveal', 'static'] as const as v (v)}
			<button type="button" class={{ on: view === v }} onclick={() => (view = v)}>{v}</button>
		{/each}
		<select bind:value={themeChoice} aria-label="Theme">
			<option value="auto">auto</option>
			<option value="light">light</option>
			<option value="dark">dark</option>
		</select>
	</nav>

	{#if view === 'guess'}
		<div class="full">
			<GuessMap
				bind:this={guessMap}
				bind:touched
				{initialCenter}
				{initialZoom}
				{locked}
				color="#e6424a"
				attributionPosition="bottom-left"
				onchange={(g) => {
					last = g;
					changes++;
				}}
			/>
		</div>
		<div class="panel top" data-testid="guess-state">
			<span>lat <b data-testid="lat">{last?.lat.toFixed(4) ?? '-'}</b></span>
			<span>lng <b data-testid="lng">{last?.lng.toFixed(4) ?? '-'}</b></span>
			<span>zoom <b data-testid="zoom">{last?.zoom.toFixed(2) ?? '-'}</b></span>
			<span>touched <b data-testid="touched">{touched}</b></span>
			<span>locked <b data-testid="locked">{locked}</b></span>
			<span>updates <b data-testid="changes">{changes}</b></span>
			{#if lockedAt}<span>lockedAt <b data-testid="locked-at">{lockedAt.lat.toFixed(4)}, {lockedAt.lng.toFixed(4)}</b></span>{/if}
		</div>
		<div class="panel bottom">
			{#if locked}
				<button type="button" data-testid="unlock" onclick={() => (locked = false)}>Unlock</button>
			{:else}
				<button type="button" class="primary" data-testid="lock" disabled={!touched} onclick={lockIn}>Lock in</button>
			{/if}
			<button
				type="button"
				data-testid="reset"
				onclick={() => {
					locked = false;
					lockedAt = null;
					guessMap?.reset();
				}}>Reset</button
			>
			<button
				type="button"
				data-testid="read"
				onclick={() => {
					last = guessMap?.getGuess() ?? null;
				}}>Read now</button
			>
		</div>
	{:else if view === 'reveal'}
		<div class="full">
			{#key `${n}-${target}-${startedAt}`}
				<RevealMap
					{players}
					{result}
					mode={final ? 'final' : 'live'}
					highlightPlayerId="p2"
					padding={{ top: 56, bottom: 120 }}
					onstage={(s) => (stage = s)}
				/>
			{/key}
		</div>
		<div class="panel bottom reveal-controls">
			<div class="row">
				{#each [3, 12, 40] as count (count)}
					<button type="button" class={{ on: n === count }} onclick={() => ((n = count), replay())}>{count}</button>
				{/each}
				<select bind:value={target} onchange={replay} aria-label="Target">
					{#each Object.entries(TARGETS) as [k, v] (k)}<option value={k}>{v.nameEn}</option>{/each}
				</select>
				<button type="button" data-testid="replay" onclick={replay}>Replay</button>
				<button type="button" data-testid="skip" onclick={() => (skipped = true)}>Skip</button>
				<button type="button" onclick={() => ((seed = seed + 1), replay())}>Reroll</button>
				<label><input type="checkbox" bind:checked={final} /> final</label>
				<label><input type="checkbox" bind:checked={cluster} onchange={replay} /> cluster</label>
				<span>stage <b data-testid="stage">{stage ?? '-'}</b></span>
			</div>
			{#if stage === 'done'}
				<p class="answer"><b>{result.target.nameEn}</b> · {result.target.factEn}</p>
			{/if}
		</div>
	{:else}
		<div class="static">
			<div class="card">
				<div class="preview"><StaticPointMap lat={pLat} lng={pLng} onpick={(a, b) => ((pLat = a), (pLng = b), picks++)} /></div>
				<div class="row">
					<label>lat <input type="number" step="any" bind:value={pLat} /></label>
					<label>lng <input type="number" step="any" bind:value={pLng} /></label>
					<span>picks {picks}</span>
				</div>
			</div>
			<div class="card">
				<div class="preview small"><StaticPointMap lat={-17.71} lng={178.06} zoom={5} /></div>
				<p>Static, no onpick (Fiji, zoom 5)</p>
			</div>
		</div>
	{/if}
</div>

<style>
	.pg {
		position: fixed;
		inset: 0;
		background: var(--color-bg);
	}
	.full {
		position: absolute;
		inset: 0;
	}
	.tabs {
		position: absolute;
		z-index: 10;
		top: calc(var(--safe-top) + var(--space-2));
		right: var(--space-2);
		display: flex;
		gap: var(--space-1);
	}
	button,
	select {
		min-height: 2.25rem;
		padding: 0 var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	button.on,
	button.primary {
		background: var(--color-primary);
		color: var(--color-primary-contrast);
		border-color: var(--color-primary);
	}
	button:disabled {
		opacity: 0.5;
	}
	.panel {
		position: absolute;
		z-index: 10;
		left: var(--space-2);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		box-shadow: var(--shadow-md);
		font-size: var(--text-xs);
	}
	.panel.top {
		top: calc(var(--safe-top) + 3.25rem);
		right: var(--space-2);
	}
	.panel.bottom {
		bottom: calc(var(--safe-bottom) + var(--space-5));
		right: var(--space-2);
		justify-content: center;
	}
	.reveal-controls {
		flex-direction: column;
		align-items: stretch;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.answer {
		font-size: var(--text-md);
	}
	.static {
		position: absolute;
		inset: 3.5rem var(--space-3) var(--space-3);
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		align-content: flex-start;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		font-size: var(--text-sm);
	}
	.preview {
		width: min(22rem, 85vw);
		height: 15rem;
		border-radius: var(--radius-md);
		overflow: hidden;
	}
	.preview.small {
		width: 14rem;
		height: 9rem;
	}
	input[type='number'] {
		width: 7rem;
		padding: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
</style>
