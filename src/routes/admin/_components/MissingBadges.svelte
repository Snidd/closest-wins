<!-- Translation badges: one per language that lacks any text the other language has. -->
<script lang="ts">
	import type { Locale } from '#lib/i18n/locale.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import Badge from './Badge.svelte';

	type Props = {
		missing: { name: Locale[]; clueText: Locale[]; fact: Locale[] };
		/** Show a "Complete" badge when nothing is missing. */
		showComplete?: boolean;
	};
	let { missing, showComplete = false }: Props = $props();
	const t = useT(admin);

	const fieldLabel = (f: 'name' | 'clueText' | 'fact') =>
		f === 'name' ? t().name : f === 'clueText' ? t().clueText : t().fact;

	const perLang = $derived(
		(['sv', 'en'] as const)
			.map((lang) => ({
				lang,
				fields: (['name', 'clueText', 'fact'] as const).filter((f) => missing[f].includes(lang))
			}))
			.filter((x) => x.fields.length > 0)
	);
</script>

<span class="badges">
	{#each perLang as { lang, fields } (lang)}
		<Badge tone="warn" title="{t().missingTranslationTitle}: {fields.map(fieldLabel).join(', ')}">
			{t().missingLang(lang === 'sv' ? t().sv : t().en)}
		</Badge>
	{:else}
		{#if showComplete}<Badge tone="ok">{t().complete}</Badge>{/if}
	{/each}
</span>

<style>
	.badges {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
</style>
