import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import {
	createCustomField,
	createFieldBody,
	deleteCustomField,
	listCustomFields,
	migrateQuery,
	updateCustomField,
	updateFieldBody,
} from "#lib/server/admin/fields.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

function descriptionFrom(form: FormData) {
	const value = String(form.get("description") ?? "").trim();
	return value === "" ? null : value;
}

function firstIssue(error: z.ZodError) {
	return error.issues[0]?.message ?? "Check the field details";
}

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-fields");
	return {
		fields: (await listCustomFields(actor)).map(
			({ optionCount: _optionCount, ...field }) => field,
		),
	};
}) satisfies PageServerLoad;

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "create") {
			const parsed = createFieldBody.safeParse({
				name: form.get("name"),
				description: descriptionFrom(form),
				type: form.get("type"),
				required: form.has("required"),
			});
			if (!parsed.success) {
				return fail(400, { error: firstIssue(parsed.error) });
			}
			const field = await createCustomField(actor, parsed.data);
			redirect(
				303,
				`/secure/admin/ConfigureCustomField!default.jspa?id=${encodeURIComponent(field.id)}`,
			);
		}

		if (intent === "update") {
			const id = z.uuid().safeParse(form.get("id"));
			if (!id.success) return fail(400, { error: "Invalid custom field" });
			const parsed = updateFieldBody.safeParse({
				name: form.get("name"),
				description: descriptionFrom(form),
				required: form.has("required"),
			});
			if (!parsed.success) {
				return fail(400, { error: firstIssue(parsed.error) });
			}
			await updateCustomField(actor, id.data, parsed.data);
			return { updated: true };
		}

		if (intent === "delete") {
			const id = z.uuid().safeParse(form.get("id"));
			if (!id.success) return fail(400, { error: "Invalid custom field" });
			const migrateTo = String(form.get("migrateTo") ?? "");
			const parsed = migrateQuery.safeParse({
				migrateTo: migrateTo === "" ? undefined : migrateTo,
			});
			if (!parsed.success) {
				return fail(400, { error: "Invalid target field" });
			}
			await deleteCustomField(actor, id.data, parsed.data);
			return { deleted: true };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
