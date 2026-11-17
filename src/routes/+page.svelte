<!--
  Landing: the game's name and one action, entering the 4-letter join code. Works without
  JavaScript (GET /join?code=… normalises and redirects); with JavaScript the input cleans up
  what you type or paste as you go. No `maxlength`: it would cut a pasted " ab cd" before it
  can be cleaned up (the sanitiser caps the length instead).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { JOIN_CODE_LENGTH } from '#lib/game/types.ts';
	import Button from '#lib/ui/Button.svelte';
	import mark from '#lib/assets/favicon.svg';
	import { sanitizeJoinCode } from './join/join-code.ts';

	const t = useT(common);

	// `?code=` comes back from the no-JS fallback when the code could not be a code.
	const returned = page.url.searchParams.get('code');
	let code = $state(returned ? sanitizeJoinCode(returned).code : '');
	let rejected = $state(false);
	let focused = $state(false);
	let incomplete = $state(returned !== null);

	const complete = $derived(code.length === JOIN_CODE_LENGTH);
	const message = $derived(
		rejected ? t().joinCodeRejected : incomplete && !complete ? t().joinCodeIncomplete : null
	);

	function apply(raw: string, input: HTMLInputElement) {
		const result = sanitizeJoinCode(raw);
		code = result.code;
		rejected = result.rejected;
		incomplete = false;
		// Keep the DOM in sync even when the state value did not change (e.g. a rejected key).
		input.value = code;
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		apply(e.currentTarget.value, e.currentTarget);
	}

	/** A code is typed left to right: keep the caret at the end, wherever the field was tapped. */
	function caretToEnd(e: Event & { currentTarget: HTMLInputElement }) {
		const el = e.currentTarget;
		const toEnd = () => el.setSelectionRange(el.value.length, el.value.length);
		toEnd();
		// Taps place the caret after focus/pointerup; correct it once more on the next frame. Only
		// a caret: a selection made since then (select all to replace the code) must survive a
		// late frame.
		requestAnimationFrame(() => {
			if (el.selectionStart === el.selectionEnd) toEnd();
		});
	}

	function onsubmit(e: SubmitEvent) {
		e.preventDefault();
		if (complete) goto(`/join/${code}`);
		else incomplete = true;
	}
</script>

<svelte:head>
	<title>{t().appName}</title>
	<meta name="description" content={t().tagline} />
</svelte:head>

<main class="landing">
	<div class="hero">
		<svg class="art" viewBox="0 0 280 172" aria-hidden="true">
			<g class="rings">
				<circle cx="140" cy="96" r="26" />
				<circle cx="140" cy="96" r="50" />
				<circle cx="140" cy="96" r="74" />
			</g>
			<g class="lines">
				<path d="M140 96 L164 82" />
				<path d="M140 96 L84 126" />
				<path d="M140 96 L218 44" />
			</g>
			<g class="cross">
				<path d="M140 80v10M140 102v10M124 96h10M146 96h10" />
				<circle cx="140" cy="96" r="3" />
			</g>
			<g class="pin p3" style:--pin="var(--player-1)" transform="translate(218 44)">
				<g><path d="M0 0C-5-7-9-11-9-16a9 9 0 1 1 18 0c0 5-4 9-9 16z" /><circle cy="-16" r="3.4" /></g>
			</g>
			<g class="pin p2" style:--pin="var(--player-3)" transform="translate(84 126)">
				<g><path d="M0 0C-5-7-9-11-9-16a9 9 0 1 1 18 0c0 5-4 9-9 16z" /><circle cy="-16" r="3.4" /></g>
			</g>
			<g class="pin p1" style:--pin="var(--player-0)" transform="translate(164 82)">
				<g>
					<path d="M0 0C-5-7-9-11-9-16a9 9 0 1 1 18 0c0 5-4 9-9 16z" /><circle cy="-16" r="3.4" />
					<path class="crown" d="M-8-31l3.5-9 4.5 5.5 4.5-5.5 3.5 9z" />
				</g>
			</g>
		</svg>

		<div class="title">
			<img class="mark" src={mark} alt="" width="40" height="40" />
			<h1>{t().appName}</h1>
		</div>
		<p class="tagline">{t().tagline}</p>
	</div>

	<form class="join" action="/join" method="GET" {onsubmit} novalidate>
		<label for="join-code">{t().joinCode}</label>
		<div class={['code-field', { focused, invalid: !!message }]}>
			{#each { length: JOIN_CODE_LENGTH }, i}
				<span class={['slot', { next: i === Math.min(code.length, JOIN_CODE_LENGTH - 1) }]} style:--i={i}
				></span>
			{/each}
			<input
			id="join-code"
			name="code"
			class="code-input"
			value={code}
			{oninput}
			onfocus={(e) => {
				focused = true;
				caretToEnd(e);
			}}
			onpointerup={caretToEnd}
			onblur={() => (focused = false)}
			autocomplete="off"
			autocapitalize="characters"
			autocorrect="off"
			spellcheck={false}
			enterkeyhint="go"
			aria-describedby="join-code-desc"
			aria-invalid={message ? true : undefined}
			data-testid="join-code"
			/>
		</div>
		<p id="join-code-desc" class={['desc', { warn: !!message }]} aria-live="polite">
			{message ?? t().joinCodeHint}
		</p>
		<Button type="submit" size="xl" block>{t().join}</Button>
	</form>

	<footer class="host">
		<span class="muted">{t().hostPrompt}</span>
		<a href="/host">{t().hostGame}</a>
	</footer>
</main>

<style>
	.landing {
		min-height: 100dvh;
		max-width: 26rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: calc(var(--space-6) + var(--safe-top)) calc(var(--space-5) + var(--safe-right))
			calc(var(--space-5) + var(--safe-bottom)) calc(var(--space-5) + var(--safe-left));
	}
	:global(body):has(.landing) {
		background:
			radial-gradient(120% 55% at 50% 0%, color-mix(in oklab, var(--color-primary) 16%, transparent), transparent 70%),
			var(--color-bg);
	}

	/* Hero ------------------------------------------------------------------------------------ */
	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-3);
		margin-top: auto;
	}
	.art {
		width: min(100%, 18rem);
		height: auto;
		overflow: visible;
		margin-bottom: var(--space-2);
	}
	.rings circle {
		fill: none;
		stroke: var(--color-border);
		stroke-width: 1.5;
	}
	.rings circle:first-child {
		fill: color-mix(in oklab, var(--color-primary) 8%, transparent);
	}
	.lines path {
		stroke: var(--color-text-muted);
		stroke-width: 1.5;
		stroke-dasharray: 3 4;
		stroke-linecap: round;
		opacity: 0.7;
	}
	.cross path {
		stroke: var(--color-text);
		stroke-width: 2.5;
		stroke-linecap: round;
	}
	.cross circle {
		fill: var(--color-accent);
	}
	.pin > g {
		animation: drop 700ms var(--ease-out) both;
	}
	.pin path:first-child {
		fill: var(--pin);
		stroke: #fff;
		stroke-width: 2;
	}
	.pin circle {
		fill: #fff;
	}
	.crown {
		fill: var(--color-accent);
		stroke: color-mix(in oklab, var(--color-accent) 60%, black);
		stroke-width: 1;
		stroke-linejoin: round;
		animation: pop 500ms 900ms var(--ease-out) both;
		transform-box: fill-box;
		transform-origin: 50% 100%;
	}
	.p2 > g {
		animation-delay: 150ms;
	}
	.p3 > g {
		animation-delay: 300ms;
	}
	.p1 > g {
		animation-delay: 450ms;
	}
	@keyframes drop {
		from {
			transform: translateY(-40px);
			opacity: 0;
		}
		60% {
			opacity: 1;
		}
	}
	@keyframes pop {
		from {
			transform: scale(0);
		}
	}

	.title {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}
	.mark {
		width: 2.5rem;
		height: 2.5rem;
		flex: none;
		border-radius: 0.6rem;
		box-shadow: var(--shadow-sm);
	}
	h1 {
		font-size: clamp(2.1rem, 10vw, 2.9rem);
		letter-spacing: -0.02em;
	}
	.tagline {
		color: var(--color-text-muted);
		font-size: var(--text-lg);
		max-width: 20rem;
		text-wrap: balance;
	}

	/* Join form ------------------------------------------------------------------------------- */
	.join {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	label {
		font-weight: var(--weight-bold);
		text-align: center;
		font-size: var(--text-md);
	}
	/*
	 * Four letter slots behind a transparent monospace input. Each slot is 2ch wide (1ch glyph +
	 * 1ch letter-spacing) and the text starts 0.5ch in, so glyphs sit centred in the boxes.
	 * The boxes are static markup, so it looks the same before hydration and without JS.
	 */
	.code-field {
		--slot-border: color-mix(in oklab, var(--color-text) 18%, transparent);
		position: relative;
		align-self: center;
		font-family: var(--font-mono);
		font-size: 2.75rem;
		font-weight: var(--weight-bold);
		line-height: 1;
	}
	.slot {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(0.1ch + var(--i) * 2ch);
		width: 1.8ch;
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		border: 2px solid transparent;
		border-bottom-color: var(--slot-border);
		transition:
			border-color var(--duration-fast),
			background-color var(--duration-fast);
		pointer-events: none;
	}
	.code-field:focus-within .slot.next {
		border-color: var(--color-primary);
		background: var(--color-surface);
	}
	.invalid .slot {
		border-bottom-color: var(--color-warning);
	}
	.code-input {
		position: relative;
		display: block;
		box-sizing: content-box;
		width: 8ch;
		height: 1.1em;
		padding: 0.3em 0 0.3em 0.5ch;
		border: 0;
		outline: none;
		background: transparent;
		font: inherit;
		letter-spacing: 1ch;
		text-transform: uppercase;
		color: var(--color-text);
		caret-color: var(--color-primary);
	}
	/* With JavaScript the highlighted slot shows where the next letter goes. */
	.focused .code-input {
		caret-color: transparent;
	}
	.code-input:focus-visible {
		outline: none;
	}
	.desc {
		text-align: center;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		min-height: 1.45em;
	}
	.desc.warn {
		color: var(--color-warning);
		font-weight: var(--weight-medium);
	}

	/* Host link ------------------------------------------------------------------------------- */
	.host {
		margin-top: auto;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-1) var(--space-2);
		font-size: var(--text-sm);
	}
	.host a {
		font-weight: var(--weight-medium);
		text-underline-offset: 0.2em;
	}
</style>
