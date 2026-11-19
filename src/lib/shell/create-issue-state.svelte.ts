import type { CreateDefaults } from "#lib/issue-form/types.ts";

/** The one create dialog the shell owns; pages only ask for it to open. */
export const createIssueState = $state<{
	defaults: CreateDefaults | null;
	onCreated: ((key: string) => void) | null;
}>({ defaults: null, onCreated: null });

/** `onCreated` runs with the key of every issue the dialog creates, for the page that asked. */
export function openCreateIssue(
	defaults: CreateDefaults = {},
	options: { onCreated?: (key: string) => void } = {},
) {
	if (typeof window === "undefined") return;
	createIssueState.defaults = defaults;
	createIssueState.onCreated = options.onCreated ?? null;
}

export function closeCreateIssue() {
	if (typeof window === "undefined") return;
	createIssueState.defaults = null;
	createIssueState.onCreated = null;
}
