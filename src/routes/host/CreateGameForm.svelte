<!--
  Create-game form. The visible controls are custom (cards, chips, steppers); what is submitted
  comes from hidden inputs that mirror local state. Only each field's `name` is taken from the
  remote form: its `value` would fall back to the last submitted value after a failed submit.
  On success `createGame` redirects (303) to `/host/{id}`.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { createGame } from '#lib/remote/game.remote.ts';
	import { MAX_ROUNDS, TIMER_MAX_SECONDS, TIMER_MIN_SECONDS } from '#lib/game/types.ts';
	import type { PlaylistSummary } from '#lib/server/content/index.ts';
	import { localized, type Locale } from '#lib/i18n/index.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import Button from '#lib/ui/Button.svelte';
	import Stepper from './Stepper.svelte';
	import Segmented from './Segmented.svelte';

	type Props = { playlists: PlaylistSummary[] };
	let { playlists }: Props = $props();

	const t = useT(host);
	const c = useT(common);
	const locale = useLocale();
	const LAST_KEY = 'cw:host:lastPlaylist';
	const TIMER_PRESETS = [15, 30, 45, 60, 90];

	const playable = $derived(playlists.filter((p) => p.locationCount > 0));

	let selectedId = $state<string | null>(null);
	let roundsText = $state('');
	let secondsText = $state('');
	let selection = $state<'first' | 'random'>('first');
	let shuffle = $state(false);
	// svelte-ignore state_referenced_locally
	let language = $state<Locale>(locale());
	let submitError = $state<string | null>(null);

	const selected = $derived(playlists.find((p) => p.id === selectedId) ?? null);
	const maxRounds = $derived(selected ? Math.min(selected.locationCount, MAX_ROUNDS) : MAX_ROUNDS);

	const parseIntStrict = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number.parseInt(s, 10) : NaN);
	const rounds = $derived(parseIntStrict(roundsText));
	const seconds = $derived(parseIntStrict(secondsText));
	const roundsValid = $derived(Number.isInteger(rounds) && rounds >= 1 && rounds <= maxRounds);
	const secondsValid = $derived(
		Number.isInteger(seconds) && seconds >= TIMER_MIN_SECONDS && seconds <= TIMER_MAX_SECONDS
	);
	const canSubmit = $derived(!!selected && roundsValid && secondsValid);

	const roundPresets = $derived(
		[
			...[5, 10].filter((n) => n < maxRounds).map((n) => ({ value: String(n), label: String(n) })),
			{ value: String(maxRounds), label: t().allRounds(maxRounds) }
		]
	);
	const timerPresets = $derived.by(() => {
		const def = selected?.defaultTimerSeconds;
		const values = [...new Set([...TIMER_PRESETS, ...(def ? [def] : [])])].sort((a, b) => a - b);
		return values.map((v) => ({
			value: String(v),
			label: `${v}`,
			sub: v === def ? t().playlistDefault : undefined
		}));
	});

	function choose(p: PlaylistSummary) {
		if (p.locationCount === 0) return;
		submitError = null;
		if (selectedId === p.id) return;
		selectedId = p.id;
		roundsText = String(Math.min(p.locationCount, MAX_ROUNDS));
		secondsText = String(p.defaultTimerSeconds);
	}

	/** Set once hydrated: taps on the custom controls only work from here on (tests wait for it). */
	let ready = $state(false);

	onMount(() => {
		ready = true;
		if (selectedId) return;
		let last: string | null = null;
		try {
			last = localStorage.getItem(LAST_KEY);
		} catch {
			last = null;
		}
		const preferred = playable.find((p) => p.id === last) ?? (playable.length === 1 ? playable[0] : undefined);
		if (preferred) choose(preferred);
	});

	const name = (p: PlaylistSummary) => localized(p, 'name', locale()) || t().unnamedPlaylist;
	const languageName = (l: Locale) => {
		const n = l === 'sv' ? c().languageSv : c().languageEn;
		return locale() === 'sv' ? n.toLowerCase() : n;
	};

	// Hidden input names (with Kit's type prefixes, e.g. `n:roundCount/...`).
	const f = createGame.fields;
	const names = $derived({
		playlistId: f.playlistId.as('hidden', '').name,
		roundCount: f.roundCount.as('hidden', 0).name,
		selection: f.selection.as('hidden', 'first').name,
		timerSeconds: f.timerSeconds.as('hidden', 0).name,
		language: f.language.as('hidden', 'en').name,
		shuffle: f.shuffle.as('checkbox').name
	});
	const serverIssues = $derived([...new Set((f.allIssues() ?? []).map((i) => i.message))]);

	const enhanced = createGame.enhance(async ({ submit }) => {
		submitError = null;
		try {
			localStorage.setItem(LAST_KEY, selectedId ?? '');
		} catch {
			// storage unavailable: preselection is a nicety
		}
		try {
			await submit();
		} catch (e) {
			const err = e as { status?: number; body?: { message?: string } };
			submitError = err?.status === 401 ? t().sessionExpiredBody : (err?.body?.message ?? c().errorGeneric);
		}
	});
</script>

<form {...enhanced} class="create" novalidate data-ready={ready}>
	<h1>{t().newGame}</h1>

	<fieldset class="group">
		<legend class="label">{t().choosePlaylist}</legend>
		<div class="playlists" role="radiogroup" aria-label={t().choosePlaylist}>
			{#each playlists as p (p.id)}
				{@const empty = p.locationCount === 0}
				{@const isSelected = selectedId === p.id}
				<button
					type="button"
					role="radio"
					aria-checked={isSelected}
					class={['playlist', { selected: isSelected, empty }]}
					disabled={empty}
					onclick={() => choose(p)}
					data-testid="playlist-option"
				>
					<span class="radio" aria-hidden="true"></span>
					<span class="pl-body">
						<span class="pl-name">{name(p)}</span>
						<span class="pl-meta">
							{empty ? t().noLocations : `${t().locationsCount(p.locationCount)} · ${t().secondsPerRoundShort(p.defaultTimerSeconds)}`}
						</span>
						{#if isSelected && p.missingTranslationCount > 0}
							<span class="pl-warn" data-testid="translation-warning">
								{t().missingTranslations(p.missingTranslationCount, languageName(language))}
							</span>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</fieldset>

	{#if selected}
		<div class="options">
			<Stepper
				id="rounds"
				label={t().rounds}
				bind:value={roundsText}
				min={1}
				max={maxRounds}
				presets={roundPresets}
				error={roundsValid ? null : t().roundsRange(maxRounds)}
				decreaseLabel={t().decrease}
				increaseLabel={t().increase}
			/>

			{#if roundsValid && rounds < maxRounds}
				<Segmented
					label={t().which}
					bind:value={selection}
					options={[
						{ value: 'first', label: t().selectionFirst(rounds) },
						{ value: 'random', label: t().selectionRandom(rounds) }
					]}
				/>
			{/if}

			<Segmented
				label={t().order}
				bind:value={() => (shuffle ? 'shuffled' : 'playlist'), (v) => (shuffle = v === 'shuffled')}
				options={[
					{ value: 'playlist', label: t().orderPlaylist },
					{ value: 'shuffled', label: t().orderShuffled }
				]}
			/>

			<Stepper
				id="seconds"
				label={t().secondsPerRound}
				bind:value={secondsText}
				min={TIMER_MIN_SECONDS}
				max={TIMER_MAX_SECONDS}
				step={5}
				presets={timerPresets}
				error={secondsValid ? null : t().secondsRange(TIMER_MIN_SECONDS, TIMER_MAX_SECONDS)}
				decreaseLabel={t().decrease}
				increaseLabel={t().increase}
			/>

			<Segmented
				label={t().tvLanguage}
				hint={t().tvLanguageHint}
				bind:value={language}
				options={[
					{ value: 'sv', label: c().languageSv },
					{ value: 'en', label: c().languageEn }
				]}
			/>
		</div>
	{/if}

	<!-- What is actually submitted. -->
	<input type="hidden" name={names.playlistId} value={selectedId ?? ''} />
	<input type="hidden" name={names.roundCount} value={roundsValid ? rounds : ''} />
	<input type="hidden" name={names.selection} value={roundsValid && rounds < maxRounds ? selection : 'first'} />
	<input type="hidden" name={names.timerSeconds} value={secondsValid ? seconds : ''} />
	<input type="hidden" name={names.language} value={language} />
	<input type="checkbox" hidden name={names.shuffle} checked={shuffle} />

	<div class="dock">
		{#if submitError || serverIssues.length}
			<div class="alert" role="alert">
				{#each submitError ? [submitError, ...serverIssues] : serverIssues as m (m)}<p>{m}</p>{/each}
			</div>
		{/if}
		{#if selected && canSubmit}
			<p class="summary" data-testid="create-summary">{t().summary(rounds, seconds)}</p>
		{/if}
		<Button type="submit" size="xl" block disabled={!canSubmit} busy={createGame.pending > 0} data-testid="create-game">
			{createGame.pending > 0 ? t().creating : selected ? t().createGame : t().choosePlaylistFirst}
		</Button>
	</div>
</form>

<style>
	.create {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	h1 {
		font-size: var(--text-2xl);
	}
	.group {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.label {
		padding: 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-bold);
		color: var(--color-text-muted);
	}
	.playlists {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.playlist {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		min-height: 4rem;
		padding: var(--space-3) var(--space-4);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--duration-fast),
			background-color var(--duration-fast);
	}
	.playlist:hover:not(:disabled) {
		border-color: var(--color-primary);
	}
	.playlist.selected {
		border-color: var(--color-primary);
		background: color-mix(in oklab, var(--color-primary) 8%, var(--color-surface));
	}
	.playlist.empty {
		cursor: not-allowed;
		opacity: 0.55;
		border-style: dashed;
	}
	.radio {
		flex: none;
		width: 1.35rem;
		height: 1.35rem;
		margin-top: 0.15rem;
		border-radius: 50%;
		border: 2px solid var(--color-border);
		background: var(--color-surface);
		transition:
			border-color var(--duration-fast),
			box-shadow var(--duration-fast);
	}
	.selected .radio {
		border-color: var(--color-primary);
		box-shadow: inset 0 0 0 0.25rem var(--color-surface);
		background: var(--color-primary);
	}
	.pl-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.pl-name {
		font-weight: var(--weight-bold);
		font-size: var(--text-lg);
		line-height: var(--leading-tight);
	}
	.pl-meta {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.pl-warn {
		margin-top: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: color-mix(in oklab, var(--color-warning) 14%, var(--color-surface));
		color: var(--color-text);
		font-size: var(--text-sm);
		line-height: var(--leading-normal);
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-4);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}
	.dock {
		position: sticky;
		bottom: 0;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-inline: calc(-1 * var(--space-4));
		padding: var(--space-3) var(--space-4) calc(var(--space-3) + var(--safe-bottom));
		background: linear-gradient(to bottom, transparent, var(--color-bg) var(--space-4));
	}
	.summary {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.alert {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--color-danger) 12%, var(--color-surface));
		border-left: 4px solid var(--color-danger);
		font-size: var(--text-sm);
	}
</style>
