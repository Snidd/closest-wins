<!--
  Photo of a location: preview, replace (upload a file or import from a URL) and remove. Uploads
  create an unattached photo; the editor's Save attaches it (or the old one is kept), so every
  change is committed together with the location.
-->
<script lang="ts">
	import { importPhoto, uploadPhoto } from '#lib/remote/content.remote.ts';
	import { photoUrl } from '#lib/game/types.ts';
	import type { Photo } from '#lib/server/db/schema.ts';
	import { useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';

	/** Mirrors MAX_IMAGE_BYTES in #lib/server/media/limits.ts (the server enforces it). */
	const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

	type Props = {
		photo: Photo | null;
		/** The photo stored on the location (to tell whether the current one is unsaved). */
		savedPhotoId: string | null;
		onchange: (photo: Photo | null) => void;
	};
	let { photo, savedPhotoId, onchange }: Props = $props();
	const t = useT(admin);

	let picking = $state(false);
	const showPicker = $derived(picking || !photo);
	let tab = $state<'upload' | 'url'>('upload');

	let localError = $state<string | null>(null);
	let localPreview = $state<string | null>(null);
	let fileChosen = $state(false);

	function revokePreview() {
		if (localPreview) URL.revokeObjectURL(localPreview);
		localPreview = null;
	}
	$effect(() => revokePreview);

	function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		revokePreview();
		localError = null;
		fileChosen = !!file;
		if (!file) return;
		if (file.type && !file.type.startsWith('image/')) localError = t().fileNotImage;
		else if (file.size > MAX_UPLOAD_BYTES) localError = t().fileTooLarge;
		else localPreview = URL.createObjectURL(file);
	}

	function done(created: Photo | undefined, element: HTMLFormElement) {
		if (!created) return;
		onchange(created);
		element.reset();
		revokePreview();
		fileChosen = false;
		picking = false;
	}

	const upload = uploadPhoto.enhance(async (form) => {
		if (!fileChosen) localError = t().chooseFileFirst;
		if (localError) return;
		if (await form.submit().updates()) done(form.result, form.element);
	});

	const importForm = importPhoto.enhance(async (form) => {
		if (await form.submit().updates()) done(form.result, form.element);
	});

	const uploadIssues = $derived(uploadPhoto.fields.allIssues() ?? []);
	const importRootIssues = $derived(importPhoto.fields.issues() ?? []);
	const unsaved = $derived((photo?.id ?? null) !== savedPhotoId);
</script>

<div class="panel">
	<div class="head">
		<h2>{t().photo}</h2>
		{#if unsaved}<span class="pending">{t().photoPendingSave}</span>{/if}
	</div>

	{#if photo && !picking}
		<figure>
			<div class="frame" style:aspect-ratio="{photo.width} / {photo.height}">
				<img src={photoUrl(photo.fileKey, 'md')} alt={t().photo} />
			</div>
			<figcaption>
				{#if photo.attribution}<span>{photo.attribution}</span>{:else}<span class="warn">{t().attributionMissing}</span>{/if}
				{#if photo.sourceUrl}
					<a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">{t().source} ↗</a>
				{/if}
				<span class="muted">{t().photoSize(photo.width, photo.height)}</span>
			</figcaption>
		</figure>
		<div class="u-row buttons">
			<Button variant="secondary" size="sm" onclick={() => (picking = true)}>{t().replacePhoto}</Button>
			<Button variant="ghost" size="sm" onclick={() => onchange(null)}>{t().removePhoto}</Button>
		</div>
	{/if}

	{#if showPicker}
		<div class="tabs" role="tablist" aria-label={t().photo}>
			<button
				type="button"
				role="tab"
				id="tab-upload"
				aria-selected={tab === 'upload'}
				aria-controls="panel-upload"
				onclick={() => (tab = 'upload')}>{t().uploadFile}</button
			>
			<button
				type="button"
				role="tab"
				id="tab-url"
				aria-selected={tab === 'url'}
				aria-controls="panel-url"
				onclick={() => (tab = 'url')}>{t().fromUrl}</button
			>
		</div>

		<form
			{...upload}
			id="panel-upload"
			role="tabpanel"
			aria-labelledby="tab-upload"
			hidden={tab !== 'upload'}
			enctype="multipart/form-data"
			class="u-stack"
			novalidate
		>
			<div class="field">
				<label for="photo-file">{t().chooseFile}</label>
				<input id="photo-file" class="file" {...uploadPhoto.fields.file.as('file')} accept="image/*" onchange={onFile} />
				<p class="hint">{t().fileHint}</p>
			</div>
			{#if localPreview}
				<img class="local-preview" src={localPreview} alt="" />
			{/if}
			<TextInput
				label={t().attribution}
				hint={t().attributionHint}
				{...uploadPhoto.fields.attribution.as('text')}
				issues={uploadPhoto.fields.attribution.issues()}
				maxlength={300}
			/>
			<TextInput
				label={t().sourceUrl}
				hint={t().sourceUrlHint}
				{...uploadPhoto.fields.sourceUrl.as('url')}
				issues={uploadPhoto.fields.sourceUrl.issues()}
				placeholder="https://"
			/>
			{#if localError}<p class="issue" role="alert">{localError}</p>{/if}
			{#each uploadIssues.filter((i) => i.path.length === 0 || i.path[0] === 'file') as issue (issue.message)}
				<p class="issue" role="alert">{issue.message}</p>
			{/each}
			<div class="u-row buttons">
				<Button type="submit" size="sm" busy={uploadPhoto.pending > 0}>
					{uploadPhoto.pending > 0 ? t().uploading : t().upload}
				</Button>
				{#if photo}
					<Button variant="ghost" size="sm" onclick={() => (picking = false)}>{t().keepPhoto}</Button>
				{/if}
			</div>
		</form>

		<form
			{...importForm}
			id="panel-url"
			role="tabpanel"
			aria-labelledby="tab-url"
			hidden={tab !== 'url'}
			class="u-stack"
			novalidate
		>
			<TextInput
				label={t().imageUrl}
				hint={t().imageUrlHint}
				{...importPhoto.fields.url.as('url')}
				issues={importPhoto.fields.url.issues()}
				placeholder="https://upload.wikimedia.org/…"
			/>
			<TextInput
				label={t().attribution}
				hint={t().attributionHint}
				{...importPhoto.fields.attribution.as('text')}
				issues={importPhoto.fields.attribution.issues()}
				maxlength={300}
			/>
			<TextInput
				label={t().sourceUrl}
				hint={t().sourceUrlImportHint}
				{...importPhoto.fields.sourceUrl.as('url')}
				issues={importPhoto.fields.sourceUrl.issues()}
				placeholder="https://"
			/>
			{#each importRootIssues as issue (issue.message)}<p class="issue" role="alert">{issue.message}</p>{/each}
			<div class="u-row buttons">
				<Button type="submit" size="sm" busy={importPhoto.pending > 0}>
					{importPhoto.pending > 0 ? t().importing : t().importPhoto}
				</Button>
				{#if photo}
					<Button variant="ghost" size="sm" onclick={() => (picking = false)}>{t().keepPhoto}</Button>
				{/if}
			</div>
		</form>
		<p class="hint">{t().photoHint}</p>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		font-size: var(--text-lg);
	}
	.pending {
		font-size: var(--text-xs);
		font-weight: var(--weight-bold);
		color: var(--color-warning);
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.frame {
		max-height: 22rem;
		width: 100%;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--color-surface-2);
	}
	.frame img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		font-size: var(--text-sm);
	}
	.warn {
		color: var(--color-warning);
	}
	.buttons {
		gap: var(--space-2);
	}
	.tabs {
		display: flex;
		gap: var(--space-1);
		padding: 3px;
		border-radius: var(--radius-md);
		background: var(--color-surface-2);
		width: fit-content;
	}
	.tabs button {
		border: 0;
		background: none;
		padding: var(--space-1) var(--space-3);
		border-radius: calc(var(--radius-md) - 3px);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.tabs button[aria-selected='true'] {
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-sm);
	}
	form[hidden] {
		display: none;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field label {
		font-weight: var(--weight-medium);
		font-size: var(--text-sm);
	}
	.file {
		padding: var(--space-3);
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		font-size: var(--text-sm);
		max-width: 100%;
	}
	.file:hover {
		border-color: var(--color-primary);
	}
	.local-preview {
		max-height: 10rem;
		width: auto;
		border-radius: var(--radius-sm);
		object-fit: contain;
		align-self: flex-start;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
	.issue {
		color: var(--color-danger);
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
</style>
