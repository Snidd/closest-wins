<!--
  Create / edit a playlist: names (sv/en) and default timer in a form; the ordered locations are
  edited in place (drag and drop or the up/down buttons) and saved automatically.
-->
<script lang="ts">
	import * as v from 'valibot';
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		createPlaylist,
		deletePlaylist,
		setPlaylistItems,
		updatePlaylist
	} from '#lib/remote/content.remote.ts';
	import { TEXT_MAX } from '#lib/content/schemas.ts';
	import type { LocationWithPhoto } from '#lib/server/content/locations.ts';
	import type { PlaylistWithItems } from '#lib/server/content/playlists.ts';
	import { useLocale, useT } from '#lib/i18n/context.ts';
	import { admin } from '#lib/i18n/admin.ts';
	import { common } from '#lib/i18n/common.ts';
	import { localized } from '#lib/i18n/localized.ts';
	import Button from '#lib/ui/Button.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import PageHeader from '../../_components/PageHeader.svelte';
	import ConfirmDialog from '../../_components/ConfirmDialog.svelte';
	import Thumb from '../../_components/Thumb.svelte';
	import MissingBadges from '../../_components/MissingBadges.svelte';
	import { errorInfo, missingOf } from '../../_components/util.ts';
	import AddLocations from './AddLocations.svelte';

	let { playlist }: { playlist: PlaylistWithItems | null } = $props();
	const t = useT(admin);
	const c = useT(common);
	const locale = useLocale();

	// svelte-ignore state_referenced_locally
	const initial = playlist;
	const isNew = !initial;
	const form = (initial ? updatePlaylist.for(initial.id) : createPlaylist) as unknown as typeof createPlaylist;

	type Values = { nameSv: string; nameEn: string; defaultTimerSeconds?: number };
	const toValues = (p: PlaylistWithItems | null): Values => ({
		nameSv: p?.nameSv ?? '',
		nameEn: p?.nameEn ?? '',
		defaultTimerSeconds: p?.defaultTimerSeconds ?? 30
	});
	let saved = $state<Values>(toValues(initial));
	form.fields.set(toValues(initial));

	const filledStr = (s: unknown) => typeof s === 'string' && s.trim() !== '';
	form.preflight(
		v.pipe(
			v.looseObject({
				nameSv: v.optional(v.pipe(v.string(), v.maxLength(TEXT_MAX.name, t().tooLong(TEXT_MAX.name)))),
				nameEn: v.optional(v.pipe(v.string(), v.maxLength(TEXT_MAX.name, t().tooLong(TEXT_MAX.name)))),
				defaultTimerSeconds: v.pipe(
					v.number(t().timerInvalid),
					v.integer(t().timerInvalid),
					v.minValue(5, t().timerInvalid),
					v.maxValue(600, t().timerInvalid)
				)
			}),
			v.forward(
				v.partialCheck(
					[['nameSv'], ['nameEn']],
					(i) => filledStr(i.nameSv) || filledStr(i.nameEn),
					t().nameRequired
				),
				['nameSv']
			)
		) as never
	);

	const values = $derived(form.fields.value() as Partial<Values>);
	const norm = (x: Partial<Values>) => JSON.stringify([x.nameSv ?? '', x.nameEn ?? '', x.defaultTimerSeconds ?? null]);
	const dirty = $derived(norm(values) !== norm(saved));
	let justSaved = $state(false);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;

	const enhanced = form.enhance(async (f) => {
		const ok = await f.submit().updates();
		if (!ok) return;
		if (isNew && f.result) {
			await goto(`/admin/playlists/${f.result.id}`, { replace: true });
			return;
		}
		saved = values as Values;
		justSaved = true;
		clearTimeout(savedTimer);
		savedTimer = setTimeout(() => (justSaved = false), 2500);
	});

	const title = $derived(isNew ? t().newPlaylist : localized(values as Required<Values>, 'name', locale()) || t().untitled);
	const rootIssues = $derived(form.fields.issues() ?? []);

	// --- Items -------------------------------------------------------------------------------------
	let items = $state<LocationWithPhoto[]>(initial?.items.map((i) => i.location) ?? []);
	const included = $derived(new Set(items.map((i) => i.id)));
	let orderState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let orderError = $state('');
	let announcement = $state('');
	let saving = false;
	let again = false;

	async function persist() {
		if (!initial) return;
		if (saving) {
			again = true;
			return;
		}
		saving = true;
		orderState = 'saving';
		try {
			do {
				again = false;
				await setPlaylistItems({ playlistId: initial.id, locationIds: items.map((i) => i.id) });
			} while (again);
			orderState = 'saved';
		} catch (e) {
			orderState = 'error';
			orderError = errorInfo(e).message;
		} finally {
			saving = false;
		}
	}

	const nameOf = (l: LocationWithPhoto) => localized(l, 'name', locale()) || t().untitled;

	async function move(from: number, to: number, focus?: 'up' | 'down' | 'handle') {
		if (to < 0 || to >= items.length || from === to) return;
		const next = [...items];
		const [item] = next.splice(from, 1);
		next.splice(to, 0, item!);
		items = next;
		announcement = t().moved(nameOf(item!), to + 1, next.length);
		void persist();
		if (focus) {
			await tick();
			const row = document.querySelector<HTMLElement>(`[data-item="${item!.id}"]`);
			let target = row?.querySelector<HTMLElement>(`[data-focus="${focus}"]`);
			// At the edges the pressed button is disabled; keep focus on the other one.
			if (target?.hasAttribute('disabled')) {
				target = row?.querySelector<HTMLElement>(`[data-focus="${focus === 'up' ? 'down' : 'up'}"]`);
			}
			target?.focus();
		}
	}

	function remove(index: number) {
		items = items.filter((_, i) => i !== index);
		void persist();
	}

	function add(location: LocationWithPhoto) {
		if (included.has(location.id)) return;
		items = [...items, location];
		announcement = t().moved(nameOf(location), items.length, items.length);
		void persist();
	}

	// Drag and drop (pointer users); the buttons are the keyboard/touch path.
	let dragIndex = $state<number | null>(null);
	let dropIndex = $state<number | null>(null);

	function onDragStart(e: DragEvent, index: number) {
		dragIndex = index;
		e.dataTransfer?.setData('text/plain', items[index]!.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}
	function onDragOver(e: DragEvent, index: number) {
		if (dragIndex === null) return;
		e.preventDefault();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropIndex = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		if (dragIndex !== null && dropIndex !== null) {
			const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
			void move(dragIndex, to);
		}
		dragIndex = dropIndex = null;
	}
	function onDragEnd() {
		dragIndex = dropIndex = null;
	}

	// A refreshed playlist (e.g. a stale cached query revalidating) is taken over only where there
	// are no local edits: the details while the form is clean, the items while no save is running.
	$effect(() => {
		const p = playlist;
		if (!p) return;
		untrack(() => {
			const incoming = toValues(p);
			if (norm(incoming) !== norm(saved) && !dirty && form.pending === 0) {
				saved = incoming;
				form.fields.set(incoming);
			}
			const ids = p.items.map((i) => i.location.id).join();
			if (!saving && orderState !== 'error' && ids !== items.map((i) => i.id).join()) {
				items = p.items.map((i) => i.location);
			}
		});
	});

	// --- Delete ------------------------------------------------------------------------------------
	let confirmOpen = $state(false);
	let deleting = $state(false);
	let deleteError = $state<string | null>(null);
	async function doDelete() {
		if (!initial) return;
		deleting = true;
		deleteError = null;
		try {
			await deletePlaylist({ id: initial.id });
			confirmOpen = false;
			await goto('/admin/playlists');
		} catch (e) {
			deleteError = errorInfo(e).message || c().errorGeneric;
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head><title>{title} · {t().playlists} · {c().appName}</title></svelte:head>

<PageHeader {title} back={{ href: '/admin/playlists', label: t().playlists }}>
	{#snippet actions()}
		{#if !isNew}
			<Button variant="ghost" class="danger-link" onclick={() => ((deleteError = null), (confirmOpen = true))}
				>{t().deletePlaylist}</Button
			>
		{/if}
	{/snippet}
</PageHeader>

<div class="layout">
	<form {...enhanced} class="card details" novalidate>
		<div class="names">
			<TextInput
				label="{t().name} ({t().swedish})"
				{...form.fields.nameSv.as('text')}
				issues={form.fields.nameSv.issues()}
				maxlength={TEXT_MAX.name}
				autocomplete="off"
			/>
			<TextInput
				label="{t().name} ({t().english})"
				{...form.fields.nameEn.as('text')}
				issues={form.fields.nameEn.issues()}
				maxlength={TEXT_MAX.name}
				autocomplete="off"
			/>
		</div>
		<div class="timer">
			<TextInput
				label={t().defaultTimer}
				hint={t().defaultTimerHint}
				{...form.fields.defaultTimerSeconds.as('number')}
				issues={form.fields.defaultTimerSeconds.issues()}
				min="5"
				max="600"
				step="1"
				inputmode="numeric"
			/>
		</div>
		<div class="form-foot">
			<div class="status" aria-live="polite">
				{#each rootIssues as issue (issue.message)}<p class="issue">{issue.message}</p>{/each}
				{#if !rootIssues.length}
					{#if justSaved && !dirty}<span class="ok">✓ {t().saved}</span>
					{:else if dirty && !isNew}<span class="muted">● {t().unsavedChanges}</span>{/if}
				{/if}
			</div>
			<Button type="submit" busy={form.pending > 0} disabled={!isNew && !dirty}>
				{form.pending > 0 ? t().saving : isNew ? t().createPlaylist : t().savePlaylist}
			</Button>
		</div>
	</form>

	{#if isNew}
		<p class="card muted note">{t().createPlaylistFirst}</p>
	{:else}
		<section class="card items" aria-labelledby="items-title">
			<div class="items-head">
				<h2 id="items-title">{t().playlistLocations}</h2>
				<span class="muted count">{t().locationsInPlaylist(items.length)}</span>
				<span class="order-state" aria-live="polite">
					{#if orderState === 'saving'}<span class="muted">{t().orderSaving}</span>
					{:else if orderState === 'saved'}<span class="ok">✓ {t().orderSaved}</span>
					{:else if orderState === 'error'}
						<span class="issue">{t().orderFailed} {orderError}</span>
						<Button size="sm" variant="secondary" onclick={persist}>{c().retry}</Button>
					{/if}
				</span>
			</div>
			<p class="visually-hidden" aria-live="assertive">{announcement}</p>

			{#if items.length === 0}
				<div class="empty">
					<p><strong>{t().playlistEmpty}</strong></p>
					<p class="muted">{t().playlistEmptyHint}</p>
				</div>
			{:else}
				<ol class="list" ondragover={(e) => dragIndex !== null && e.preventDefault()} ondrop={onDrop}>
					{#each items as item, i (item.id)}
						{@const name = nameOf(item)}
						<li
							data-item={item.id}
							draggable="true"
							ondragstart={(e) => onDragStart(e, i)}
							ondragover={(e) => onDragOver(e, i)}
							ondragend={onDragEnd}
							class:dragging={dragIndex === i}
							class:drop-before={dropIndex === i && dragIndex !== i && dragIndex !== i - 1}
							class:drop-after={dropIndex === i + 1 && i === items.length - 1 && dragIndex !== i}
						>
							<span class="handle" aria-hidden="true" title={t().dragHandle(name)}>⋮⋮</span>
							<span class="pos">{i + 1}</span>
							<Thumb fileKey={item.photo?.fileKey} label={t().textClue} />
							<span class="name">
								<a href="/admin/locations/{item.id}" draggable="false">{name}</a>
								<MissingBadges missing={missingOf(item)} />
							</span>
							<span class="buttons">
								<button
									type="button"
									class="icon"
									data-focus="up"
									aria-label={t().moveUp(name)}
									title={t().moveUp(name)}
									disabled={i === 0}
									onclick={() => move(i, i - 1, 'up')}>↑</button
								>
								<button
									type="button"
									class="icon"
									data-focus="down"
									aria-label={t().moveDown(name)}
									title={t().moveDown(name)}
									disabled={i === items.length - 1}
									onclick={() => move(i, i + 1, 'down')}>↓</button
								>
								<button
									type="button"
									class="icon danger"
									aria-label={t().removeFrom(name)}
									title={t().removeFrom(name)}
									onclick={() => remove(i)}>✕</button
								>
							</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="card add" aria-labelledby="add-title">
			<h2 id="add-title">{t().addLocations}</h2>
			<svelte:boundary>
				<AddLocations {included} onadd={add} />
				{#snippet pending()}<p class="muted">{c().loading}</p>{/snippet}
				{#snippet failed(_e, reset)}
					<p class="issue">{c().errorGeneric}</p>
					<Button size="sm" variant="secondary" onclick={reset}>{c().retry}</Button>
				{/snippet}
			</svelte:boundary>
		</section>
	{/if}
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={t().deletePlaylist}
	confirmLabel={c().delete}
	busyLabel={t().deleting}
	busy={deleting}
	error={deleteError}
	onconfirm={doDelete}
>
	<p>{t().deletePlaylistBody(title)}</p>
</ConfirmDialog>

<style>
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		grid-template-areas:
			'details details'
			'items add';
		align-items: start;
		gap: var(--space-4);
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
	.details {
		grid-area: details;
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		align-items: start;
		gap: var(--space-3) var(--space-4);
	}
	.names {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-3);
	}
	.details :global(input) {
		width: 100%;
		min-width: 0;
	}
	.form-foot {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-3);
	}
	.status {
		flex: 1;
		min-width: 10rem;
		font-size: var(--text-sm);
	}
	.note {
		grid-column: 1 / -1;
	}
	.items {
		grid-area: items;
	}
	.add {
		grid-area: add;
		position: sticky;
		top: var(--space-4);
	}
	h2 {
		font-size: var(--text-lg);
	}
	.items-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-3);
	}
	.count {
		font-size: var(--text-sm);
	}
	.order-state {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
		min-height: 2.25rem;
	}
	.empty {
		padding: var(--space-6) var(--space-4);
		text-align: center;
		border: 2px dashed var(--color-border);
		border-radius: var(--radius-md);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.list li {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-1);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
	}
	.list li:last-child {
		border-bottom: 0;
	}
	.list li:hover {
		background: var(--color-surface-2);
	}
	.dragging {
		opacity: 0.4;
	}
	.drop-before::before,
	.drop-after::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		border-radius: 2px;
		background: var(--color-primary);
	}
	.drop-before::before {
		top: -2px;
	}
	.drop-after::after {
		bottom: -2px;
	}
	.handle {
		cursor: grab;
		color: var(--color-text-muted);
		letter-spacing: -0.2em;
		padding: 0 var(--space-1);
		user-select: none;
	}
	.pos {
		width: 1.75rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
		font-weight: var(--weight-bold);
	}
	.name {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}
	.name a {
		color: var(--color-text);
		font-weight: var(--weight-medium);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.name a:hover {
		text-decoration: underline;
	}
	.buttons {
		display: flex;
		gap: 2px;
	}
	.icon {
		width: 2.25rem;
		height: 2.25rem;
		display: grid;
		place-items: center;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
		cursor: pointer;
		font-size: var(--text-md);
		line-height: 1;
	}
	.icon:hover:not(:disabled) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
	.icon.danger:hover:not(:disabled) {
		border-color: var(--color-danger);
		color: var(--color-danger);
	}
	.icon:disabled {
		opacity: 0.35;
		cursor: default;
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
		.layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas: 'details' 'items' 'add';
		}
		.add {
			position: static;
		}
		.details {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 36rem) {
		.names {
			grid-template-columns: minmax(0, 1fr);
		}
		.card {
			padding: var(--space-4);
		}
		.list li {
			gap: var(--space-2);
		}
		.handle,
		.list li :global(.thumb) {
			display: none;
		}
		.pos {
			width: 1.25rem;
		}
	}
</style>
