<script module lang="ts">
	const escapeStack: Array<() => void> = [];
</script>

<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import type { Snippet } from "svelte";

	interface Props {
		title: string;
		onClose: () => void;
		footer: Snippet;
		children: Snippet;
		width?: number;
		returnFocus?: boolean;
	}

	let {
		title,
		onClose,
		footer,
		children,
		width = 420,
		returnFocus = true,
	}: Props = $props();

	const titleId = $props.id();
	// Captured while the trigger still owns focus; a menu that opened the modal
	// may be gone by the time the effect runs.
	const previous =
		typeof document === "undefined"
			? null
			: (document.activeElement as HTMLElement | null);

	let dialog: HTMLDialogElement;
	let backdrop: HTMLDivElement;
	let panel: HTMLDivElement;
	let body: HTMLDivElement;

	const backdropStyle =
		"position: fixed; inset: 0; z-index: 200; display: flex; align-items: flex-start; justify-content: center; padding-top: 80px; background-color: rgba(0, 0, 0, 0.6);";
	let panelStyle = $derived(`width: ${width}px; max-width: calc(100vw - 32px); max-height: calc(100vh - 120px); display: flex; flex-direction: column; background-color: ${token(
		"elevation.surface.overlay",
	)}; border: 1px solid ${token(
		"color.border",
	)}; border-radius: 3px; box-shadow: ${token("elevation.shadow.overlay")};`);
	const headerStyle = `display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid ${token(
		"color.border",
	)};`;
	const titleStyle =
		"margin: 0; font-size: 20px; font-weight: 500; line-height: 24px;";
	const closeStyle = `padding: 4px; background: transparent; border: 0; color: ${token(
		"color.text.subtle",
	)}; cursor: pointer; font-size: 20px; line-height: 1;`;
	const bodyStyle = "padding: 16px 20px; overflow-y: auto;";
	const footerStyle = `display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid ${token(
		"color.border",
	)};`;

	$effect(() => {
		const modal = dialog;
		if (modal && !modal.open) modal.showModal();
		const control = body?.querySelector<HTMLElement>(
			'input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled)',
		);
		(control ?? modal)?.focus();

		const close = () => onClose();
		escapeStack.push(close);
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			queueMicrotask(() => {
				if (event.defaultPrevented) return;
				if (escapeStack[escapeStack.length - 1] !== close) return;
				close();
			});
		}
		function onMouseDown(event: MouseEvent) {
			if (event.target === backdrop) onClose();
		}
		document.addEventListener("keydown", onKeyDown);
		backdrop?.addEventListener("mousedown", onMouseDown);
		return () => {
			const index = escapeStack.lastIndexOf(close);
			if (index !== -1) escapeStack.splice(index, 1);
			document.removeEventListener("keydown", onKeyDown);
			backdrop?.removeEventListener("mousedown", onMouseDown);
			const active = document.activeElement as HTMLElement | null;
			if (modal?.open) modal.close();
			if (returnFocus && previous?.isConnected) previous.focus();
			else active?.focus();
		};
	});
</script>

<dialog
	bind:this={dialog}
	class="modal"
	aria-modal="true"
	aria-labelledby={titleId}
	oncancel={(event) => event.preventDefault()}
>
	<div bind:this={backdrop} style={backdropStyle}>
		<div bind:this={panel} style={panelStyle}>
			<div style={headerStyle}>
				<h2 id={titleId} style={titleStyle}>{title}</h2>
				<button
					type="button"
					aria-label="Close"
					onclick={onClose}
					style={closeStyle}>×</button>
			</div>
			<div bind:this={body} style={bodyStyle}>
				{@render children()}
			</div>
			<div style={footerStyle}>
				{@render footer()}
			</div>
		</div>
	</div>
</dialog>

<style>
	dialog.modal {
		display: block;
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		overflow: hidden;
	}

	dialog.modal::backdrop {
		background: transparent;
	}
</style>
