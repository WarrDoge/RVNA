import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { listIssueTypes } from "#lib/server/admin/config.ts";
import {
	createCustomFieldOption,
	createOptionBody,
	deleteCustomFieldOption,
	getCustomField,
	migrateQuery,
} from "#lib/server/admin/fields.ts";
import { listAdminProjects } from "#lib/server/admin/projects.ts";
import { isHttpError } from "#lib/server/http.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

function pageField(field: Awaited<ReturnType<typeof getCustomField>>) {
	const { sourceId: _sourceId, ...rest } = field;
	return rest;
}

async function loadField(
	actor: Parameters<typeof getCustomField>[0],
	id: string,
) {
	const parsed = z.uuid().safeParse(id);
	if (!parsed.success) {
		return { field: null, error: "This custom field does not exist." };
	}
	try {
		return {
			field: pageField(await getCustomField(actor, parsed.data)),
			error: null,
		};
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) {
			return { field: null, error: cause.message };
		}
		throw cause;
	}
}

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-field");
	const id = event.url.searchParams.get("id") ?? "";
	if (id === "") {
		return {
			id,
			field: null,
			fieldError: null,
			projects: [],
			issueTypes: [],
		};
	}

	const [loaded, projectRows, typeRows] = await Promise.all([
		loadField(actor, id),
		listAdminProjects(actor, { query: "", archived: "false" }),
		listIssueTypes(actor),
	]);
	const configurable = loaded.field?.configurable ?? false;

	return {
		id,
		field: loaded.field,
		fieldError: loaded.error,
		projects: configurable
			? projectRows.map((project) => ({
					id: project.id,
					name: project.name,
				}))
			: [],
		issueTypes: configurable
			? typeRows.map((issueType) => ({
					id: issueType.id,
					name: issueType.name,
				}))
			: [],
	};
}) satisfies PageServerLoad;

function optionValues(value: string) {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "addOption") {
			const id = z.uuid().safeParse(form.get("id"));
			if (!id.success) return fail(400, { error: "Invalid custom field" });
			const rawParent = String(form.get("parentOptionId") ?? "");
			const parentOptionId = rawParent === "" ? undefined : rawParent;
			const values = optionValues(String(form.get("value") ?? ""));
			if (values.length === 0) {
				return fail(400, { error: "Enter an option" });
			}
			for (const value of values) {
				const parsed = createOptionBody.safeParse({ value, parentOptionId });
				if (!parsed.success) {
					return fail(400, {
						error: parsed.error.issues[0]?.message ?? "Check the option",
					});
				}
				await createCustomFieldOption(actor, id.data, parsed.data);
			}
			return { added: values.length };
		}

		if (intent === "deleteOption") {
			const id = z.uuid().safeParse(form.get("id"));
			const optionId = z.uuid().safeParse(form.get("optionId"));
			if (!id.success || !optionId.success) {
				return fail(400, { error: "Invalid option" });
			}
			const migrateTo = String(form.get("migrateTo") ?? "");
			const parsed = migrateQuery.safeParse({
				migrateTo: migrateTo === "" ? undefined : migrateTo,
			});
			if (!parsed.success) {
				return fail(400, { error: "Invalid target option" });
			}
			await deleteCustomFieldOption(actor, id.data, optionId.data, parsed.data);
			return { deleted: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
