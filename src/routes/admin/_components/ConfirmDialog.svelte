<!--
  Modal confirmation (native <dialog>). `onconfirm` may throw; the message of an Error is shown
  in the dialog via `error`. Bind `open` to show/hide.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { useT } from '#lib/i18n/context.ts';
	import { common } from '#lib/i18n/common.ts';
	import Button from '#lib/ui/Button.svelte';

	type Props = {
		open: boolean;
		title: string;
		confirmLabel: string;
		busyLabel?: string;
		busy?: boolean;
		error?: string | null;
		onconfirm: () => void;
		children?: Snippet;
	};
	let { open = $bindable(), title, confirmLabel, busyLabel, busy = false, error = null, onconfirm, children }: Props =
		$props();
	const c = useT(common);
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby="confirm-title">
	<div class="body">
		<h2 id="confirm-title">{title}</h2>
		{#if children}<div class="text">{@render children()}</div>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<div class="buttons">
			<Button variant="secondary" onclick={() => (open = false)} disabled={busy}>{c().cancel}</Button>
			<Button variant="danger" {busy} onclick={onconfirm}>{busy && busyLabel ? busyLabel : confirmLabel}</Button>
		</div>
	</div>
</dialog>

<style>
	dialog {
		width: min(28rem, calc(100vw - 2rem));
		padding: 0;
		border: 0;
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-lg);
	}
	dialog::backdrop {
		background: var(--color-overlay);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
	}
	h2 {
		font-size: var(--text-xl);
	}
	.error {
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-danger) 10%, transparent);
		color: var(--color-danger);
		font-weight: var(--weight-medium);
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
</style>
