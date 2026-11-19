export const goShortcutTargets: Record<string, string> = {
	d: "/secure/Dashboard.jspa",
	i: "/issues/",
	p: "/secure/BrowseProjects.jspa",
	b: "/secure/ManageRapidViews.jspa",
};

/**
 * Jira's `g` followed by a letter: go to the dashboard, issues, projects or boards.
 * Returns the cleanup function for the document listener.
 */
export function installGoShortcuts(navigate: (path: string) => void) {
	let armedAt = 0;
	function onKeyDown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const element = event.target as HTMLElement | null;
		if (
			element?.isContentEditable ||
			["INPUT", "TEXTAREA", "SELECT"].includes(element?.tagName ?? "") ||
			document.querySelector('[role="dialog"]')
		) {
			return;
		}
		if (event.key === "g") {
			armedAt = Date.now();
			return;
		}
		const path = goShortcutTargets[event.key];
		if (!path || Date.now() - armedAt > 1500) return;
		armedAt = 0;
		// Capture phase: the issue view's own `i` must not also fire.
		event.stopPropagation();
		event.preventDefault();
		navigate(path);
	}
	document.addEventListener("keydown", onKeyDown, true);
	return () => document.removeEventListener("keydown", onKeyDown, true);
}
