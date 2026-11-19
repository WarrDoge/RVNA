import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	createAdminProject,
	createBody,
	deleteAdminProject,
	deleteBody,
	listAdminProjects,
	setAdminProjectArchived,
	updateAdminProject,
	updateBody,
} from "#lib/server/admin/projects.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-projects");
	const query = event.url.searchParams.get("query") ?? "";
	const requested = event.url.searchParams.get("filter");
	const filter =
		requested === "archived" || requested === "all" ? requested : "active";
	const projects = await listAdminProjects(actor, {
		query,
		archived:
			filter === "archived" ? "true" : filter === "all" ? "all" : "false",
	});
	return {
		projects: projects.map((project) => ({
			id: project.id,
			key: project.key,
			name: project.name,
			type: project.type,
			avatarUrl: project.avatarUrl,
			lead: project.lead,
			issueCount: project.issueCount,
			archived: project.archived,
		})),
		query,
		filter,
		me: {
			id: actor.id,
			username: actor.username,
			displayName: actor.displayName,
			avatarUrl: actor.avatarUrl,
		},
	};
}) satisfies PageServerLoad;

function message(error: { issues: { message: string }[] }) {
	return error.issues[0]?.message ?? "Invalid project";
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "create") {
			const leadId = String(form.get("leadId") ?? "");
			const templateProjectKey = String(form.get("templateProjectKey") ?? "");
			const parsed = createBody.safeParse({
				name: String(form.get("name") ?? ""),
				key: String(form.get("key") ?? ""),
				type: String(form.get("type") ?? "software"),
				...(leadId === "" ? {} : { leadId }),
				...(templateProjectKey === "" ? {} : { templateProjectKey }),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await createAdminProject(actor, parsed.data);
			return { ok: true };
		}

		if (intent === "update") {
			const originalKey = String(form.get("originalKey") ?? "");
			if (originalKey === "") return fail(404, { error: "Project not found" });
			const leadId = String(form.get("leadId") ?? "");
			const parsed = updateBody.safeParse({
				name: String(form.get("name") ?? ""),
				key: String(form.get("key") ?? ""),
				type: String(form.get("type") ?? "software"),
				leadId: leadId === "" ? null : leadId,
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await updateAdminProject(actor, originalKey, parsed.data);
			return { ok: true };
		}

		if (intent === "archive") {
			const key = String(form.get("key") ?? "");
			if (key === "") return fail(404, { error: "Project not found" });
			const parsed = z
				.enum(["true", "false"])
				.safeParse(String(form.get("archived") ?? ""));
			if (!parsed.success) {
				return fail(400, { error: "Invalid archive state" });
			}
			await setAdminProjectArchived(actor, key, parsed.data === "true");
			return { ok: true };
		}

		if (intent === "remove") {
			const key = String(form.get("key") ?? "");
			if (key === "") return fail(404, { error: "Project not found" });
			const parsed = deleteBody.safeParse({
				confirmKey: String(form.get("confirmKey") ?? ""),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await deleteAdminProject(actor, key, parsed.data);
			return { ok: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
