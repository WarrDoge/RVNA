function isTyping(target: EventTarget | null) {
	const element = target as HTMLElement | null;
	if (!element) return false;
	return (
		element.isContentEditable ||
		["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
	);
}

/**
 * One document-level shortcut, with these guards: no modifier
 * keys, no typing target and no open dialog. Returns the cleanup function.
 */
export function installShortcut(
	handler: (key: string, event: KeyboardEvent) => void,
) {
	function onKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (isTyping(event.target)) return;
		if (document.querySelector('[role="dialog"]')) return;
		handler(event.key, event);
	}
	document.addEventListener("keydown", onKeyDown);
	return () => document.removeEventListener("keydown", onKeyDown);
}
