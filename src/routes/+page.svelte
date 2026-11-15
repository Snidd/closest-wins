<!-- Landing: enter a join code, or go host. (Wave 1 "auth surfaces + landing" may restyle.) -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '#lib/game/types.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';

	const t = useT(common);
	let code = $state('');
	const normalized = $derived(code.trim().toUpperCase());
	const valid = $derived(
		normalized.length === JOIN_CODE_LENGTH && [...normalized].every((c) => JOIN_CODE_ALPHABET.includes(c))
	);
</script>

<svelte:head>
	<title>{t().appName}</title>
</svelte:head>

<main class="page page--narrow">
	<header class="stack">
		<h1>{t().appName}</h1>
		<p class="muted">{t().tagline}</p>
	</header>

	<form
		class="stack"
		action="/join"
		method="GET"
		onsubmit={(e) => {
			e.preventDefault();
			if (valid) goto(`/join/${normalized}`);
		}}
	>
		<TextInput
			label={t().joinCode}
			name="code"
			code
			bind:value={code}
			placeholder={t().joinCodePlaceholder}
			maxlength={JOIN_CODE_LENGTH}
			autocomplete="off"
			autocapitalize="characters"
			spellcheck={false}
		/>
		<Button type="submit" size="lg" block disabled={!valid}>{t().join}</Button>
	</form>

	<p><a href="/host">{t().hostGame}</a></p>
</main>
