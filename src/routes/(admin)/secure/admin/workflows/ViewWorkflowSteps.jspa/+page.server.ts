import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	createStatus,
	statusCreateBody,
	statusUpdateBody,
	updateStatus,
} from "#lib/server/admin/config.ts";
import { getWorkflow, listWorkflows } from "#lib/server/admin/workflows.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-workflows");
	const name = event.url.searchParams.get("workflowName") ?? "";
	const mode: "text" | "diagram" =
		event.url.searchParams.get("mode") === "diagram" ? "diagram" : "text";
	const workflows = await listWorkflows(actor);
	const summary = workflows.find((workflow) => workflow.name === name) ?? null;
	const detail = summary ? await getWorkflow(actor, summary.id, {}) : null;
	return { name, mode, summary, detail };
}) satisfies PageServerLoad;

export const actions = {
	createStatus: adminAction(async ({ form }, actor) => {
		const name = String(form.get("name") ?? "").trim();
		if (name === "") return fail(400, { error: "Enter a status name" });
		const parsed = statusCreateBody.safeParse({
			name,
			category: form.get("category"),
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid status",
			});
		}
		return { created: await createStatus(actor, parsed.data) };
	}),
	renameStatus: adminAction(async ({ form }, actor) => {
		const id = z.uuid().safeParse(form.get("id"));
		if (!id.success) return fail(400, { error: "Invalid status" });
		const name = String(form.get("name") ?? "").trim();
		if (name === "") return fail(400, { error: "Enter a status name" });
		const parsed = statusUpdateBody.safeParse({ name });
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid status",
			});
		}
		await updateStatus(actor, id.data, parsed.data);
		return { renamed: id.data };
	}),
} satisfies Actions;
