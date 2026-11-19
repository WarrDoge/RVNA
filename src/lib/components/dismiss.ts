import type { Attachment } from "svelte/attachments";

const triggers = new WeakMap<HTMLElement, HTMLElement>();

function focusedElement() {
	const active = document.activeElement;
	return active instanceof HTMLElement &&
		active !== document.body &&
		active !== document.documentElement
		? active
		: null;
}

/** Closes a popup on an outside mousedown or Escape while it is open. */
export function dismiss(
	open: () => boolean,
	onClose: () => void,
	trigger?: () => HTMLElement | null | undefined,
): Attachment<HTMLElement> {
	return (node) => {
		if (!open()) {
			triggers.delete(node);
			return;
		}
		if (!triggers.has(node)) {
			const target =
				trigger?.() ??
				focusedElement() ??
				node.querySelector<HTMLElement>(
					'[aria-expanded="true"][aria-haspopup]',
				);
			if (target) triggers.set(node, target);
		}

		function restoreFocus() {
			const target = triggers.get(node);
			triggers.delete(node);
			if (target?.isConnected) target.focus();
		}
		function onMouseDown(event: MouseEvent) {
			if (!node.contains(event.target as Node)) onClose();
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			onClose();
			restoreFocus();
		}
		// A menu item may open a modal in its own click handler. Focus the
		// trigger first so the modal captures the right element to return to.
		function onClick(event: MouseEvent) {
			const target = event.target as HTMLElement | null;
			if (!target || !node.contains(target)) return;
			if (!target.closest('[role="menuitem"], a[href]')) return;
			const trigger = triggers.get(node);
			if (trigger?.isConnected) trigger.focus();
		}

		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("click", onClick, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("click", onClick, true);
			const active = document.activeElement;
			if (
				!active ||
				active === document.body ||
				active === document.documentElement ||
				node.contains(active)
			) {
				restoreFocus();
			} else {
				triggers.delete(node);
			}
		};
	};
}
