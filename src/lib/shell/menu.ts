/**
 * Closes a menu on an outside mousedown or Escape. Escape returns focus to the
 * trigger for the menus that do that.
 */
export function menuDismiss(
	open: () => boolean,
	close: () => void,
	trigger?: () => HTMLElement | null | undefined,
) {
	return (node: HTMLElement) => {
		if (!open()) return;

		function onMouseDown(event: MouseEvent) {
			if (!node.contains(event.target as Node)) close();
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			close();
			trigger?.()?.focus();
		}

		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	};
}
