import { fail } from "@sveltejs/kit";
import {
	assignmentBody,
	getWorkflowAssignment,
	setWorkflowAssignment,
} from "#lib/server/admin/workflows.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-workflows");
	return {
		assignment: await getWorkflowAssignment(actor, event.params.key),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: adminAction(async ({ event, form }, actor) => {
		const defaultWorkflowId = String(form.get("defaultWorkflowId") ?? "");
		const perType: { issueTypeId: string; workflowId: string }[] = [];
		const statusMapping: Record<string, string> = {};
		for (const [key, value] of form.entries()) {
			if (typeof value !== "string" || value === "") continue;
			if (key.startsWith("workflow:")) {
				perType.push({
					issueTypeId: key.slice("workflow:".length),
					workflowId: value,
				});
			} else if (key.startsWith("mapping:")) {
				statusMapping[key.slice("mapping:".length)] = value;
			}
		}
		const parsed = assignmentBody.safeParse({
			defaultWorkflowId: defaultWorkflowId === "" ? null : defaultWorkflowId,
			perType,
			statusMapping,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid assignment",
			});
		}
		return setWorkflowAssignment(actor, event.params.key, parsed.data);
	}),
} satisfies Actions;
