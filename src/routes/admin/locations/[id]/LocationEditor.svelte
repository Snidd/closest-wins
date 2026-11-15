<!--
  Create / edit a location: bilingual texts side by side, coordinates (inputs, paste parser, map),
  photo (separate upload/import forms; attached on Save) and delete.
-->
<script lang="ts">
	import * as v from 'valibot';
	import { untrack } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { createLocation, deleteLocation, updateLocation } from '#lib/remote/content.remote.ts';
	import { TEXT_MAX } from '#lib/content/schemas.ts';
	import type { LocationWithPhoto } from '#lib/server/content/locations.ts';
	import type { Photo } from '#lib/server/db/schema.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import PageHeader from '../../_components/PageHeader.svelte';
	import TextArea from '../../_components/TextArea.svelte';
	import ConfirmDialog from '../../_components/ConfirmDialog.svelte';
	import MapPreview from '../../_components/MapPreview.svelte';
	import { errorInfo, fmtCoord } from '../../_components/util.ts';
	import PhotoPanel from './PhotoPanel.svelte';
	import { parseCoordinates } from '../coords.ts';

	let { location }: { location: LocationWithPhoto | null } = $props();

	const t = useT(admin);
	const c = useT(common);
	const locale = useLocale();

	// The editor is keyed by location id, so the initial row is fixed for its lifetime.
	// svelte-ignore state_referenced_locally
	const initial = location;
	const isNew = !initial;
	// Both forms take the same fields; the update form also carries the id (added by `.for`).
	const form = (initial ? updateLocation.for(initial.id) : createLocation) as unknown as typeof createLocation;

	type Values = {
		nameSv: string;
		nameEn: string;
		clueTextSv: string;
		clueTextEn: string;
		factSv: string;
		factEn: string;
		lat?: number;
		lng?: number;
	};
	const toValues = (l: LocationWithPhoto | null): Values => ({
		nameSv: l?.nameSv ?? '',
		nameEn: l?.nameEn ?? '',
		clueTextSv: l?.clueTextSv ?? '',
		clueTextEn: l?.clueTextEn ?? '',
		factSv: l?.factSv ?? '',
		factEn: l?.factEn ?? '',
		...(l ? { lat: l.lat, lng: l.lng } : {})
	});

	let saved = $state<Values>(toValues(initial));
	let savedPhotoId = $state<string | null>(initial?.photoId ?? null);
	let photo = $state<Photo | null>(initial?.photo ?? null);
	form.fields.set({ ...toValues(initial), photoId: initial?.photoId ?? '' });

	// Localised client-side checks; the server repeats them with the shared schema.
	const filledStr = (s: unknown) => typeof s === 'string' && s.trim() !== '';
	const text = (max: number) => v.optional(v.pipe(v.string(), v.maxLength(max, t().tooLong(max))));
	form.preflight(
		v.pipe(
			v.looseObject({
				nameSv: text(TEXT_MAX.name),
				nameEn: text(TEXT_MAX.name),
				clueTextSv: text(TEXT_MAX.clue),
				clueTextEn: text(TEXT_MAX.clue),
				factSv: text(TEXT_MAX.fact),
				factEn: text(TEXT_MAX.fact),
				lat: v.pipe(
					v.number(t().latRequired),
					v.minValue(-90, t().latRequired),
					v.maxValue(90, t().latRequired)
				),
				lng: v.pipe(
					v.number(t().lngRequired),
					v.minValue(-180, t().lngRequired),
					v.maxValue(180, t().lngRequired)
				),
				photoId: v.optional(v.string())
			}),
			v.forward(
				v.partialCheck(
					[['nameSv'], ['nameEn']],
					(i) => filledStr(i.nameSv) || filledStr(i.nameEn),
					t().nameRequired
				),
				['nameSv']
			),
			v.forward(
				v.partialCheck(
					[['clueTextSv'], ['clueTextEn'], ['photoId']],
					(i) => filledStr(i.photoId) || filledStr(i.clueTextSv) || filledStr(i.clueTextEn),
					t().clueRequired
				),
				['clueTextSv']
			)
		) as never
	);

	const values = $derived(form.fields.value() as Partial<Values>);
	const lat = $derived(typeof values.lat === 'number' && Number.isFinite(values.lat) ? values.lat : undefined);
	const lng = $derived(typeof values.lng === 'number' && Number.isFinite(values.lng) ? values.lng : undefined);

	const norm = (x: Partial<Values>) =>
		JSON.stringify([
			x.nameSv ?? '',
			x.nameEn ?? '',
			x.clueTextSv ?? '',
			x.clueTextEn ?? '',
			x.factSv ?? '',
			x.factEn ?? '',
			x.lat ?? null,
			x.lng ?? null
		]);
	const dirty = $derived(norm(values) !== norm(saved) || (photo?.id ?? null) !== savedPhotoId);

	// A refreshed row (e.g. a stale cached query revalidating) replaces the form only while the
	// form has no unsaved edits.
	$effect(() => {
		const l = location;
		if (!l) return;
		untrack(() => {
			const incoming = toValues(l);
			if (norm(incoming) === norm(saved) && (l.photoId ?? null) === savedPhotoId) return;
			if (dirty || form.pending > 0) return;
			saved = incoming;
			savedPhotoId = l.photoId ?? null;
			photo = l.photo ?? null;
			form.fields.set({ ...incoming, photoId: l.photoId ?? '' });
		});
	});

	let justSaved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	let leaving = false;

	const enhanced = form.enhance(async (f) => {
		// `.updates()` takes control of refreshing: the update form refreshes `getLocation` itself.
		const ok = await f.submit().updates();
		if (!ok) return;
		const row = f.result;
		if (isNew && row) {
			leaving = true;
			await goto(`/admin/locations/${row.id}`, { replace: true });
			return;
		}
		saved = values as Values;
		savedPhotoId = photo?.id ?? null;
		justSaved = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (justSaved = false), 2500);
	});

	beforeNavigate((nav) => {
		if (leaving || !dirty || nav.type === 'leave') return;
		if (!confirm(t().leaveUnsaved)) nav.cancel();
	});

	function onKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			form.element?.requestSubmit();
		}
	}

	// --- Coordinates ---------------------------------------------------------------------------
	let paste = $state('');
	const parsed = $derived(paste.trim() ? parseCoordinates(paste) : null);
	function setPoint(newLat: number, newLng: number) {
		form.fields.lat.set(Math.round(newLat * 1e6) / 1e6);
		form.fields.lng.set(Math.round(newLng * 1e6) / 1e6);
	}
	$effect(() => {
		if (parsed) setPoint(parsed.lat, parsed.lng);
	});

	// --- Photo -----------------------------------------------------------------------------------
	function onPhotoChange(p: Photo | null) {
		photo = p;
	}

	// --- Delete ----------------------------------------------------------------------------------
	let confirmOpen = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	async function doDelete() {
		if (!initial) return;
		deleting = true;
		deleteError = null;
		try {
			await deleteLocation({ id: initial.id });
			leaving = true;
			confirmOpen = false;
			await goto('/admin/locations');
		} catch (e) {
			const { status, message } = errorInfo(e);
			deleteError = status === 409 ? t().locationInUse : message || c().errorGeneric;
		} finally {
			deleting = false;
		}
	}

	const title = $derived(
		isNew ? t().newLocation : localized(values as Required<Values>, 'name', locale()) || t().untitled
	);
	const rootIssues = $derived(form.fields.issues() ?? []);
	const langs = [
		{ key: 'Sv', label: () => t().swedish, short: () => t().sv },
		{ key: 'En', label: () => t().english, short: () => t().en }
	] as const;
	const groups = [
		{ field: 'name', label: () => t().name, hint: null, max: TEXT_MAX.name, multiline: false },
		{ field: 'clueText', label: () => t().clueText, hint: () => t().clueTextHint, max: TEXT_MAX.clue, multiline: true },
		{ field: 'fact', label: () => t().fact, hint: () => t().factHint, max: TEXT_MAX.fact, multiline: true }
	] as const;
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:head><title>{title} · {t().locations} · {c().appName}</title></svelte:head>

<PageHeader {title} back={{ href: '/admin/locations', label: t().locations }}>
	{#snippet actions()}
		{#if !isNew}
			<Button variant="ghost" class="danger-link" onclick={() => ((deleteError = null), (confirmOpen = true))}
				>{t().deleteLocation}</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="editor">
	<form {...enhanced} class="location-form" novalidate>
		<section class="card texts" aria-label={t().name}>
			{#each groups as g (g.field)}
				<fieldset>
					<legend>{g.label()}</legend>
					{#if g.hint}<p class="hint">{g.hint()}</p>{/if}
					<div class="pair">
						{#each langs as lang (lang.key)}
							{@const name = `${g.field}${lang.key}` as keyof Values}
							{@const other = `${g.field}${lang.key === 'Sv' ? 'En' : 'Sv'}` as keyof Values}
							{@const field = form.fields[name as 'nameSv']}
							{@const gap = !filledStr(values[name]) && filledStr(values[other])}
							<div class="lang">
								<div class="lang-label">
									<span class="lang-tag">{lang.short()}</span>
									{#if gap}<span class="gap" title={t().fallbackNote(lang.label())}>{t().missingTranslationTitle}</span>{/if}
								</div>
								{#if g.multiline}
									<TextArea
										label="{g.label()} ({lang.label()})"
										hideLabel
										{...field.as('text')}
										issues={field.issues()}
										max={g.max}
										rows={g.field === 'fact' ? 4 : 3}
									/>
								{:else}
									<TextInput
										label="{g.label()} ({lang.label()})"
										hideLabel
										{...field.as('text')}
										issues={field.issues()}
										maxlength={g.max}
										autocomplete="off"
									/>
								{/if}
							</div>
						{/each}
					</div>
				</fieldset>
			{/each}
		</section>

		<section class="card place">
			<h2>{t().place}</h2>
			<TextInput
				label={t().pasteCoordinates}
				placeholder={t().pasteCoordinatesPlaceholder}
				hint={parsed
					? t().coordinatesRead(fmtCoord(parsed.lat), fmtCoord(parsed.lng))
					: paste.trim()
						? undefined
						: t().pasteCoordinatesHint}
				issues={paste.trim() && !parsed ? [{ message: t().coordinatesUnreadable }] : undefined}
				bind:value={paste}
				autocomplete="off"
				onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && e.preventDefault()}
			/>
			<div class="coords">
				<TextInput
					label={t().latitude}
					{...form.fields.lat.as('number')}
					issues={form.fields.lat.issues()}
					step="any"
					min="-90"
					max="90"
					inputmode="decimal"
				/>
				<TextInput
					label={t().longitude}
					{...form.fields.lng.as('number')}
					issues={form.fields.lng.issues()}
					step="any"
					min="-180"
					max="180"
					inputmode="decimal"
				/>
			</div>
			<MapPreview {lat} {lng} zoom={4} onpick={setPoint} />
			<input {...form.fields.photoId.as('hidden', photo?.id ?? '')} />
		</section>

		<footer class="savebar">
			<div class="status" aria-live="polite">
				{#each rootIssues as issue (issue.message)}<p class="issue">{issue.message}</p>{/each}
				{#if !rootIssues.length}
					{#if justSaved && !dirty}
						<span class="ok">✓ {t().saved}</span>
					{:else if dirty && !isNew}
						<span class="muted">● {t().unsavedChanges}</span>
					{/if}
				{/if}
			</div>
			<Button href="/admin/locations" variant="secondary">{c().cancel}</Button>
			<Button type="submit" busy={form.pending > 0}>
				{form.pending > 0 ? t().saving : isNew ? t().createLocation : t().saveLocation}
			</Button>
		</footer>
	</form>

	<section class="card photo">
		<PhotoPanel {photo} {savedPhotoId} onchange={onPhotoChange} />
	</section>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t().deleteLocation}
	confirmLabel={c().delete}
	busyLabel={t().deleting}
	busy={deleting}
	error={deleteError}
	onconfirm={doDelete}
>
	<p>{t().deleteLocationBody(title)}</p>
</ConfirmDialog>

<style>
	.editor {
		display: grid;
		grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
		grid-template-areas:
			'texts place'
			'texts photo'
			'save save';
		align-items: start;
		gap: var(--space-4);
	}
	/* The form's children join the grid so the (separate) photo forms can sit beside them. */
	.location-form {
		display: contents;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		min-width: 0;
	}
	.texts {
		grid-area: texts;
		gap: var(--space-4);
	}
	.photo {
		grid-area: photo;
	}
	.place {
		grid-area: place;
	}
	h2 {
		font-size: var(--text-lg);
	}
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	legend {
		padding: 0;
		font-weight: var(--weight-bold);
		font-size: var(--text-md);
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.pair {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-3);
		margin-top: var(--space-1);
	}
	.lang {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.lang-label {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 1.25rem;
	}
	.lang-tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		letter-spacing: 0.06em;
		color: var(--color-text-muted);
	}
	.gap {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		color: var(--color-warning);
		cursor: help;
	}
	.coords {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-3);
	}
	.coords :global(input),
	.pair :global(input) {
		width: 100%;
		min-width: 0;
	}
	.savebar {
		grid-area: save;
		position: sticky;
		bottom: 0;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: color-mix(in srgb, var(--color-surface) 92%, transparent);
		backdrop-filter: blur(6px);
		box-shadow: var(--shadow-md);
	}
	.status {
		flex: 1;
		min-width: 10rem;
		font-size: var(--text-sm);
	}
	.issue {
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
	.ok {
		color: var(--color-success);
		font-weight: var(--weight-bold);
	}

	@media (max-width: 60rem) {
		.editor {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'texts' 'place' 'photo' 'save';
		}
	}
	@media (max-width: 36rem) {
		.pair,
		.coords {
			grid-template-columns: minmax(0, 1fr);
		}
		.card {
			padding: var(--space-4);
		}
		.savebar {
			padding: var(--space-2) var(--space-3);
		}
		.status {
			min-width: 0;
			flex-basis: 100%;
		}
		.status:not(:has(*)) {
			display: none;
		}
	}
</style>
