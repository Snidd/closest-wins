<!--
  Join a game: the URL in the TV's QR code. Loads fast (no map, no live query), one input,
  usable one-handed. The server load decides the state (see +page.server.ts); the `joinGame`
  remote form is the source of truth for everything it cannot know (nickname taken, kicked, a
  game that filled up or ended in the meantime). Works without JavaScript too.
-->
<script lang="ts">
	import { joinGame } from '#lib/remote/game.remote.ts';
	import { JoinGameSchema, NICKNAME_MAX_LENGTH } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import mark from '#lib/assets/favicon.svg';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = useT(common);

	const STORAGE_KEY = 'cw:lastNickname';
	/** Hard cap in UTF-16 units, same as the server schema (emoji sequences are long). */
	const MAX_UTF16 = 64;

	const segmenter =
		typeof Intl !== 'undefined' && 'Segmenter' in Intl
			? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
			: null;
	const graphemes = (s: string): string[] =>
		segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);

	const nickname = joinGame.fields.nickname;
	// A local `bind:value` instead of the field's `value` prop: bind:value keeps what a player
	// typed before hydration (the QR code often opens this page on a slow phone). The remote form
	// reads the input itself on submit; the initial value is the server echo after a no-JS submit.
	let nick = $state(String(nickname.value() ?? ''));
	const nicknameProps = $derived.by(() => {
		const { value: _value, ...rest } = nickname.as('text');
		return rest;
	});
	const used = $derived(graphemes(nick.trim()).length);
	const left = $derived(NICKNAME_MAX_LENGTH - used);

	/** The shared schema's messages are English; show them in the player's language. */
	function localize(message: string): string {
		switch (message) {
			case 'Nickname is required':
				return t().nicknameRequired;
			case `At most ${NICKNAME_MAX_LENGTH} characters`:
				return t().nicknameTooLong(NICKNAME_MAX_LENGTH);
			case 'Invalid characters':
				return t().nicknameInvalidChars;
			case 'Invalid game code':
				return t().gameNotFoundTitle;
			default:
				return message;
		}
	}

	// One message at a time: an empty name also fails the character check, which is just noise.
	const nicknameIssues = $derived((nickname.issues() ?? []).slice(0, 1).map((i) => localize(i.message)));
	// Anything not about the nickname (bad code, issues on the whole form).
	const otherIssues = $derived(
		[
			...new Set(
				(joinGame.fields.allIssues() ?? [])
					.filter((i) => i.path[0] !== 'nickname')
					.map((i) => localize(i.message))
			)
		]
	);
	let submitError = $state<string | null>(null);
	const formMessages = $derived(submitError ? [submitError, ...otherIssues] : otherIssues);

	/** Never let a nickname grow past 16 graphemes while typing or pasting; cut gracefully. */
	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		submitError = null;
		const el = e.currentTarget;
		const parts = graphemes(el.value);
		if (parts.length > NICKNAME_MAX_LENGTH) {
			const kept = parts.slice(0, NICKNAME_MAX_LENGTH).join('');
			el.value = kept;
			nick = kept;
			// Svelte delegates `input`, so the form has already read the long value: sync it.
			nickname.set(kept);
		}
	}

	function remember(name: string) {
		try {
			localStorage.setItem(STORAGE_KEY, name);
		} catch {
			// Private mode / storage disabled: prefill is a nicety.
		}
	}

	/** Focus on load and prefill the last nickname used on this phone. */
	function setup(el: HTMLInputElement) {
		if (!el.value) {
			let saved: string | null = null;
			try {
				saved = localStorage.getItem(STORAGE_KEY);
			} catch {
				saved = null;
			}
			if (saved) nick = saved.slice(0, MAX_UTF16);
		}
		requestAnimationFrame(() => {
			el.focus({ preventScroll: true });
			const end = el.value.length;
			el.setSelectionRange(end, end);
		});
	}

	function errorMessage(e: unknown): string {
		const err = e as { status?: number; body?: { status?: number; message?: string } } | null;
		const status = err?.body?.status ?? err?.status;
		const message = err?.body?.message;
		if (status === 404) return t().gameNotFoundTitle;
		if (status === 403) return t().kickedFromGame;
		if (status && status >= 400 && status < 500 && message) return localize(message);
		return t().errorGeneric;
	}

	const enhanced = joinGame.preflight(JoinGameSchema).enhance(async (form) => {
		submitError = null;
		const name = nick.trim();
		try {
			const ok = await form.submit();
			if (ok) remember(name);
		} catch (e) {
			submitError = errorMessage(e);
		}
	});
</script>

<svelte:head>
	<title>{t().joinGameCode(data.code)} · {t().appName}</title>
</svelte:head>

<main class="join" data-state={data.state}>
	<header class="top">
		<a class="brand" href="/">
			<img src={mark} alt="" width="28" height="28" />
			<span>{t().appName}</span>
		</a>
		{#if data.state === 'open' || data.state === 'unchecked'}
			<span class="code-chip" data-testid="join-code-chip">
				{t().joinCode} <strong class="code u-code">{data.code}</strong>
			</span>
		{/if}
	</header>

	{#if data.state === 'open' || data.state === 'unchecked'}
		<form {...enhanced} class="form" novalidate>
			<h1>{t().joinHeading}</h1>

			<input {...joinGame.fields.code.as('hidden', data.code)} />

			<div class="field">
				<label for="nickname" class="visually-hidden">{t().nickname}</label>
				<input
					id="nickname"
					{...nicknameProps}
					bind:value={nick}
					class={['nick', { invalid: nicknameIssues.length > 0 }]}
					placeholder={t().nicknamePlaceholder}
					autocomplete="nickname"
					autocapitalize="words"
					autocorrect="off"
					spellcheck={false}
					enterkeyhint="go"
					maxlength={MAX_UTF16}
					required
					aria-describedby="nickname-desc"
					{oninput}
					{@attach setup}
				/>
				<div id="nickname-desc" class="below">
					<div class="msg" aria-live="polite">
						{#if nicknameIssues.length}
							{#each nicknameIssues as message (message)}
								<p class="issue">{message}</p>
							{/each}
						{:else}
							<p class="hint">{t().nicknameHint}</p>
						{/if}
					</div>
					<span class={['count', { near: left <= 3, over: left < 0 }]} data-testid="nickname-count">
						<span aria-hidden="true">{used}/{NICKNAME_MAX_LENGTH}</span>
						<span class="visually-hidden">{t().charactersLeft(Math.max(0, left))}</span>
					</span>
				</div>
			</div>

			{#if formMessages.length}
				<div class="alert" role="alert">
					{#each formMessages as message (message)}<p>{message}</p>{/each}
				</div>
			{/if}

			<Button type="submit" size="xl" block busy={joinGame.pending > 0}>
				{joinGame.pending > 0 ? t().joining : t().joinSubmit}
			</Button>
		</form>

		<section class="howto" aria-labelledby="howto-title">
			<h2 id="howto-title">{t().howToPlay}</h2>
			<ol>
				<li>{t().howToClue}</li>
				<li>{t().howToCross}</li>
				<li>{t().howToWin}</li>
			</ol>
		</section>
	{:else}
		<section class="state" data-state={data.state}>
			<div class="icon" aria-hidden="true">
				{#if data.state === 'full'}
					<svg viewBox="0 0 48 48"
						><circle cx="17" cy="17" r="7" /><circle cx="32" cy="17" r="7" /><path
							d="M4 40c1-8 6-12 13-12s12 4 13 12M24 30c2-1.5 5-2 8-2 7 0 12 4 13 12"
						/></svg
					>
				{:else}
					<svg viewBox="0 0 48 48"
						><circle cx="24" cy="24" r="16" /><path d="M24 4v8M24 36v8M4 24h8M36 24h8" /><path
							class="q"
							d="M20 20.5a4 4 0 1 1 5.5 3.7c-1 .5-1.5 1.2-1.5 2.3v1M24 31.5v.5"
						/></svg
					>
				{/if}
			</div>
			{#if data.state === 'full'}
				<h1>{t().gameFullTitle}</h1>
				<p class="muted">{t().gameFullBody}</p>
			{:else}
				<h1>{t().gameNotFoundTitle}</h1>
				<p class="muted">{t().gameNotFoundBody(data.code)}</p>
			{/if}
			<Button href="/" size="lg" block>{t().tryAnotherCode}</Button>
		</section>
	{/if}
</main>

<style>
	.join {
		min-height: 100dvh;
		max-width: 26rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-5) + var(--safe-right))
			calc(var(--space-5) + var(--safe-bottom)) calc(var(--space-5) + var(--safe-left));
	}
	:global(body):has(.join) {
		background:
			radial-gradient(120% 45% at 50% 0%, color-mix(in oklab, var(--color-primary) 14%, transparent), transparent 70%),
			var(--color-bg);
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--tap-target);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}
	.brand img {
		border-radius: 0.4rem;
	}
	.code-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 0.35em;
		padding: 0.3em 0.8em;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}
	.code-chip .code {
		color: var(--color-text);
		font-size: var(--text-md);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: clamp(var(--space-2), 8vh, var(--space-8));
	}
	h1 {
		font-size: clamp(1.75rem, 8vw, 2.25rem);
		letter-spacing: -0.015em;
		text-wrap: balance;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.nick {
		width: 100%;
		min-height: 4rem;
		padding: 0 var(--space-4);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		transition: border-color var(--duration-fast);
	}
	.nick::placeholder {
		color: var(--color-text-muted);
		opacity: 0.6;
		font-weight: var(--weight-medium);
	}
	.nick:focus {
		border-color: var(--color-primary);
		outline: none;
	}
	.nick.invalid {
		border-color: var(--color-danger);
	}
	.below {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
		padding-inline: var(--space-1);
		font-size: var(--text-sm);
		min-height: 1.45em;
	}
	.hint {
		color: var(--color-text-muted);
	}
	.issue {
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
	.count {
		flex: none;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.count.near {
		color: var(--color-warning);
		font-weight: var(--weight-bold);
	}
	.count.over {
		color: var(--color-danger);
	}
	.alert {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: color-mix(in oklab, var(--color-danger) 12%, var(--color-surface));
		color: var(--color-text);
		border-left: 4px solid var(--color-danger);
	}

	.howto {
		margin-top: auto;
		padding-top: var(--space-5);
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.howto h2 {
		font-size: var(--text-xs);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.howto ol {
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.howto li {
		counter-increment: step;
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}
	.howto li::before {
		content: counter(step);
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		color: var(--color-primary);
		font-weight: var(--weight-bold);
		font-size: var(--text-xs);
		transform: translateY(-0.1rem);
	}

	.state {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: var(--space-4);
		margin-block: auto;
		padding-bottom: var(--space-7);
	}
	.state .muted {
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
	.icon .q {
		stroke: var(--color-accent);
		stroke-width: 3;
	}
</style>
