import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	createWorkflow,
	createWorkflowBody,
	deleteWorkflow,
	listWorkflows,
} from "#lib/server/admin/workflows.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-workflows");
	return { workflows: await listWorkflows(actor) };
}) satisfies PageServerLoad;

export const actions = {
	create: adminAction(async ({ form }, actor) => {
		const name = String(form.get("name") ?? "").trim();
		if (name === "") return fail(400, { error: "Enter a workflow name" });
		const copyFromId = String(form.get("copyFromId") ?? "");
		const parsed = createWorkflowBody.safeParse({
			name,
			description: String(form.get("description") ?? ""),
			copyFromId: copyFromId === "" ? undefined : copyFromId,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid workflow",
			});
		}
		return { created: await createWorkflow(actor, parsed.data) };
	}),
	delete: adminAction(async ({ form }, actor) => {
		const parsed = z.uuid().safeParse(form.get("id"));
		if (!parsed.success) return fail(400, { error: "Invalid workflow" });
		await deleteWorkflow(actor, parsed.data);
		return { deleted: parsed.data };
	}),
} satisfies Actions;
