<!--
  Pair the big screen: the TV at `<origin>/tv` shows a 6-digit code; typing it here attaches that
  screen to this game. Submits by itself once six digits are in. Render at most one instance at
  a time (it uses the shared `pairTv` remote form).
-->
<script lang="ts">
	import { pairTv } from '#lib/remote/game.remote.ts';
	import { PAIRING_CODE_LENGTH } from '#lib/game/types.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { host } from '#lib/i18n/host.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = { gameId: string; tvUrl: string; onpaired?: () => void; oncancel?: () => void };
	let { gameId, tvUrl, onpaired, oncancel }: Props = $props();

	const t = useT(host);
	const c = useT(common);

	let code = $state('');
	let submitError = $state<string | null>(null);
	/** Hide the last attempt's issues while a new code is being typed. */
	let showIssues = $state(true);
	let formEl = $state<HTMLFormElement | null>(null);

	const field = pairTv.fields.pairingCode;
	// Without `value`: a local bind keeps what was typed before hydration (see the join page).
	const codeProps = $derived.by(() => {
		const { value: _value, ...rest } = field.as('text');
		return rest;
	});
	const localize = (m: string) => (m === 'Enter the 6-digit code' ? t().pairingCodeInvalid : m);
	const issues = $derived(
		showIssues
			? [
		...new Set([
			...(submitError ? [submitError] : []),
			...(pairTv.fields.allIssues() ?? []).map((i) => localize(i.message))
		])
				]
			: []
	);

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		submitError = null;
		showIssues = false;
		const el = e.currentTarget;
		const digits = el.value.replace(/\D/g, '').slice(0, PAIRING_CODE_LENGTH);
		if (digits !== el.value) el.value = digits;
		code = digits;
		field.set(digits);
		if (digits.length === PAIRING_CODE_LENGTH && pairTv.pending === 0) {
			queueMicrotask(() => formEl?.requestSubmit());
		}
	}

	const enhanced = pairTv.enhance(async ({ submit }) => {
		submitError = null;
		showIssues = true;
		try {
			const ok = await submit();
			if (ok && pairTv.result?.paired) {
				code = '';
				field.set('');
				onpaired?.();
			}
		} catch (e) {
			const err = e as { status?: number; body?: { message?: string } };
			submitError = err?.status === 401 ? t().sessionExpiredBody : (err?.body?.message ?? c().errorGeneric);
		}
	});
</script>

<form {...enhanced} bind:this={formEl} class="pair" novalidate data-testid="pair-tv">
	<ol class="steps">
		<li>
			<span>{t().tvStep1}</span>
			<strong class="url">{tvUrl.replace(/^https?:\/\//, '')}</strong>
		</li>
		<li><span>{t().tvStep2}</span></li>
	</ol>
	<input {...pairTv.fields.gameId.as('hidden', gameId)} />
	<div class="entry">
		<label for="pairing-code" class="visually-hidden">{t().pairingCode}</label>
		<input
			id="pairing-code"
			{...codeProps}
			bind:value={code}
			class={['code-input', { invalid: issues.length > 0 }]}
			inputmode="numeric"
			pattern="[0-9]*"
			autocomplete="one-time-code"
			enterkeyhint="go"
			maxlength={PAIRING_CODE_LENGTH}
			placeholder="000000"
			aria-describedby={issues.length ? 'pairing-issues' : undefined}
			{oninput}
		/>
		<Button type="submit" size="lg" busy={pairTv.pending > 0} disabled={code.length !== PAIRING_CODE_LENGTH}>
			{pairTv.pending > 0 ? t().pairing : t().pair}
		</Button>
	</div>
	{#if issues.length}
		<div id="pairing-issues" role="alert" class="issues">
			{#each issues as m (m)}<p>{m}</p>{/each}
		</div>
	{/if}
	{#if oncancel}
		<button type="button" class="cancel" onclick={oncancel}>{t().cancel}</button>
	{/if}
</form>

<style>
	.pair {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.steps {
		margin: 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.steps li {
		counter-increment: step;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.4em;
		padding-left: 2rem;
		position: relative;
	}
	.steps li::before {
		content: counter(step);
		position: absolute;
		left: 0;
		top: 0.05rem;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: var(--color-surface-2);
		color: var(--color-primary);
		font-weight: var(--weight-bold);
		font-size: var(--text-xs);
	}
	.url {
		font-family: var(--font-mono);
		font-size: var(--text-lg);
		word-break: break-all;
	}
	.entry {
		display: flex;
		gap: var(--space-2);
	}
	.code-input {
		flex: 1;
		min-width: 0;
		min-height: 3.5rem;
		padding: 0 var(--space-3);
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-family: var(--font-mono);
		font-size: var(--text-2xl);
		font-weight: var(--weight-bold);
		letter-spacing: 0.25em;
		text-align: center;
	}
	.code-input::placeholder {
		color: var(--color-text-muted);
		opacity: 0.35;
	}
	.code-input:focus {
		border-color: var(--color-primary);
		outline: none;
	}
	.code-input.invalid {
		border-color: var(--color-danger);
	}
	.issues {
		color: var(--color-danger);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.cancel {
		align-self: flex-start;
		min-height: 2.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--color-text-muted);
		text-decoration: underline;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}
</style>
