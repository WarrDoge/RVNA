import { fail } from "@sveltejs/kit";
import { z } from "zod";
import {
	getUser,
	listUsers,
	passwordBody,
	setUserPassword,
	updateUser,
	userUpdateBody,
} from "#lib/server/admin/users.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import { getUserProjectRoles } from "#lib/server/project-roles/service.ts";
import type { Actions, PageServerLoad } from "./$types";

const userId = z.uuid();

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-user");

	const username = event.url.searchParams.get("name")?.trim() ?? "";
	if (username === "") return { state: "missing" as const, username };

	const found = await listUsers(actor, {
		query: "",
		active: "all",
		username,
		offset: 0,
		limit: 1,
	});
	const summary = found.users[0];
	if (!summary) return { state: "notFound" as const, username };

	const [user, projectRoles] = await Promise.all([
		getUser(actor, summary.id),
		getUserProjectRoles(actor, summary.id),
	]);

	return {
		state: "found" as const,
		username,
		user,
		projectRoles: projectRoles.roles,
	};
}) satisfies PageServerLoad;

export const actions = {
	setPassword: adminAction(async ({ form }, actor) => {
		const id = userId.safeParse(form.get("userId"));
		if (!id.success) return fail(400, { error: "User not found" });

		const generate = form.get("generate") === "on";
		const password = String(form.get("password") ?? "");
		if (!generate && password === "") {
			return fail(400, { error: "Enter a password or generate one" });
		}

		const parsed = passwordBody.safeParse({
			password: generate ? undefined : password,
			generate,
			mustChangePassword: form.get("mustChangePassword") === "on",
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid password",
			});
		}

		const result = await setUserPassword(actor, id.data, parsed.data);
		return { generatedPassword: result.generatedPassword ?? null };
	}),

	updateDetails: adminAction(async ({ form }, actor) => {
		const id = userId.safeParse(form.get("userId"));
		if (!id.success) return fail(400, { error: "User not found" });

		const displayName = String(form.get("displayName") ?? "").trim();
		const email = String(form.get("email") ?? "").trim();
		if (displayName === "") {
			return fail(400, { error: "Display name is required." });
		}

		const parsed = userUpdateBody.safeParse({
			displayName,
			email: email === "" ? null : email,
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid details",
			});
		}

		await updateUser(actor, id.data, parsed.data);
		return {};
	}),
} satisfies Actions;
