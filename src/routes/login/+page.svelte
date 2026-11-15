<!-- Shared admin login for /host and /admin. (Wave 1 "auth surfaces" may restyle.) -->
<script lang="ts">
	import { login } from '#lib/remote/auth.remote.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const t = useT(common);
</script>

<svelte:head>
	<title>{t().login} · {t().appName}</title>
</svelte:head>

<main class="page page--narrow">
	<h1>{t().login}</h1>
	<p class="muted">{t().loginRequired}</p>
	<form {...login} class="stack">
		<input {...login.fields.next.as('hidden', data.next)} />
		<TextInput
			label={t().adminPassword}
			{...login.fields._password.as('password')}
			issues={login.fields._password.issues()}
			autocomplete="current-password"
			required
		/>
		<Button type="submit" size="lg" block busy={login.pending > 0}>{t().login}</Button>
	</form>
</main>
