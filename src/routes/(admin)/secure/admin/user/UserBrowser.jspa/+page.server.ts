import { fail } from "@sveltejs/kit";
import { listGroups } from "#lib/server/admin/groups.ts";
import {
	createUser,
	listUsers,
	userCreateBody,
} from "#lib/server/admin/users.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

const pageSize = 50;

function activeFilter(value: string | null): "all" | "true" | "false" {
	return value === "true" || value === "false" ? value : "all";
}

export const load = adminLoad(async (event, actor) => {
	event.depends("app:admin-users");

	const query = event.url.searchParams.get("query")?.trim() ?? "";
	const active = activeFilter(event.url.searchParams.get("active"));
	const group = event.url.searchParams.get("group")?.trim() ?? "";
	const offset = Math.max(
		0,
		Number.parseInt(event.url.searchParams.get("offset") ?? "0", 10) || 0,
	);

	const [users, groups] = await Promise.all([
		listUsers(actor, {
			query,
			active,
			group: group === "" ? undefined : group,
			offset,
			limit: pageSize,
		}),
		listGroups(actor, { query: "" }),
	]);

	return {
		users: users.users.map((user) => ({
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			email: user.email,
			avatarUrl: user.avatarUrl,
			active: user.active,
			isAdmin: user.isAdmin,
			groups: user.groups,
			lastLoginAt: user.lastLoginAt,
			hasPassword: user.hasPassword,
			hasSso: user.hasSso,
			origin: user.origin,
		})),
		total: users.total,
		groups: groups.map((item) => ({ id: item.id, name: item.name })),
		filters: { query, active, group, offset },
		pageSize,
	};
}) satisfies PageServerLoad;

export const actions = {
	createUser: adminAction(async ({ form }, actor) => {
		const username = String(form.get("username") ?? "").trim();
		const displayName = String(form.get("displayName") ?? "").trim();
		if (username === "") return fail(400, { error: "Username is required." });
		if (displayName === "") {
			return fail(400, { error: "Full name is required." });
		}

		const email = String(form.get("email") ?? "").trim();
		const password = String(form.get("password") ?? "");
		const generatePassword = form.get("generatePassword") === "on";

		const parsed = userCreateBody.safeParse({
			username,
			displayName,
			email: email === "" ? undefined : email,
			password: !generatePassword && password !== "" ? password : undefined,
			generatePassword,
			mustChangePassword: form.get("mustChangePassword") === "on",
			isAdmin: form.get("isAdmin") === "on",
		});
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? "Invalid user",
			});
		}

		const result = await createUser(actor, parsed.data);
		return { generatedPassword: result.generatedPassword ?? null };
	}),
} satisfies Actions;
