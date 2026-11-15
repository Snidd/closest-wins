<!--
  Shared admin login for /host (host's phone) and /admin (desktop). Behaviour lives in the
  `login` remote form and +page.server.ts (`next` handling); this page is only presentation.
  Error and rate-limit messages are translated on the server.
-->
<script lang="ts">
	import { login } from '#lib/remote/auth.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import mark from '#lib/assets/favicon.svg';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = useT(common);

	let show = $state(false);
	const issues = $derived(login.fields._password.issues() ?? []);
	// Without `value`: the password is never echoed anyway, and a `value` prop would wipe what
	// someone typed before the page finished hydrating.
	const passwordProps = $derived.by(() => {
		const { value: _value, ...rest } = login.fields._password.as('password');
		return rest;
	});
</script>

<svelte:head>
	<title>{t().login} · {t().appName}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="login">
	<a class="brand" href="/">
		<img src={mark} alt="" width="28" height="28" />
		<span>{t().appName}</span>
	</a>

	<section class="card">
		<header class="head">
			<p class="eyebrow">{t().loginEyebrow}</p>
			<h1>{t().login}</h1>
			<p class="muted">{t().loginRequired}</p>
		</header>

		<form {...login} class="form">
			<input {...login.fields.next.as('hidden', data.next)} />
			<div class="field">
				<label for="password">{t().adminPassword}</label>
				<div class={['control', { invalid: issues.length > 0 }]}>
					<input
						id="password"
						{...passwordProps}
						type={show ? 'text' : 'password'}
						autocomplete="current-password"
						autocapitalize="off"
						autocorrect="off"
						spellcheck={false}
						enterkeyhint="go"
						required
						aria-describedby={issues.length ? 'password-issues' : undefined}
					/>
					<button
						type="button"
						class="toggle"
						aria-pressed={show}
						aria-controls="password"
						aria-label={show ? t().hidePassword : t().showPassword}
						title={show ? t().hidePassword : t().showPassword}
						onclick={() => (show = !show)}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
							<circle cx="12" cy="12" r="3" />
							{#if show}<path d="M4 4l16 16" />{/if}
						</svg>
					</button>
				</div>
				{#if issues.length}
					<div id="password-issues" role="alert">
						{#each issues as issue (issue.message)}<p class="issue">{issue.message}</p>{/each}
					</div>
				{/if}
			</div>
			<Button type="submit" size="lg" block busy={login.pending > 0}>{t().login}</Button>
		</form>
	</section>

	<a class="back" href="/">← {t().backToStart}</a>
</main>

<style>
	.login {
		min-height: 100dvh;
		max-width: 26rem;
		margin-inline: auto;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-5);
		padding: calc(var(--space-4) + var(--safe-top)) calc(var(--space-5) + var(--safe-right))
			calc(var(--space-5) + var(--safe-bottom)) calc(var(--space-5) + var(--safe-left));
	}
	@media (min-width: 40rem) {
		.login {
			justify-content: center;
			padding-bottom: 12vh;
		}
	}
	.brand {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: var(--space-2);
		min-height: var(--tap-target);
		color: var(--color-text);
		font-weight: var(--weight-bold);
		text-decoration: none;
	}
	@media (min-width: 40rem) {
		.brand {
			align-self: center;
		}
	}
	.brand img {
		border-radius: 0.4rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		padding: var(--space-6) var(--space-5);
		background: var(--color-surface);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-md);
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.eyebrow {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--color-primary);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	label {
		font-weight: var(--weight-medium);
		font-size: var(--text-sm);
	}
	.control {
		display: flex;
		align-items: stretch;
		border: 2px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		transition: border-color var(--duration-fast);
	}
	.control:focus-within {
		border-color: var(--color-primary);
	}
	.control.invalid {
		border-color: var(--color-danger);
	}
	.control input {
		flex: 1;
		min-width: 0;
		min-height: 3.25rem;
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius-md) 0 0 var(--radius-md);
		background: transparent;
		/* 16px+ prevents iOS from zooming into focused inputs. */
		font-size: max(1.0625rem, 16px);
		outline: none;
	}
	.toggle {
		flex: none;
		display: grid;
		place-items: center;
		width: 3.25rem;
		border: 0;
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.toggle:hover {
		color: var(--color-text);
		background: var(--color-surface-2);
	}
	.toggle svg {
		width: 1.4rem;
		height: 1.4rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.issue {
		color: var(--color-danger);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.back {
		align-self: center;
		font-size: var(--text-sm);
		color: var(--color-text-muted);
		text-underline-offset: 0.2em;
	}
</style>
