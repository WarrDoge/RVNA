import { fail } from "@sveltejs/kit";
import { listIssueTypes, listPriorities } from "#lib/server/admin/config.ts";
import {
	getSettings,
	settingsBody,
	updateSettings,
} from "#lib/server/admin/system.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-settings");
	const [settings, issueTypes, priorities] = await Promise.all([
		getSettings(actor),
		listIssueTypes(actor),
		listPriorities(actor),
	]);
	return {
		settings,
		issueTypes: issueTypes
			.filter((issueType) => !issueType.subtask)
			.map((issueType) => ({ id: issueType.id, name: issueType.name })),
		priorities: priorities.map((priority) => ({
			id: priority.id,
			name: priority.name,
		})),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const parsed = settingsBody.safeParse({
			title: form.get("title"),
			defaultIssueTypeId: form.get("defaultIssueTypeId") || null,
			defaultPriorityId: form.get("defaultPriorityId") || null,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid settings",
			});
		}
		return { settings: await updateSettings(actor, parsed.data) };
	}),
} satisfies Actions;
