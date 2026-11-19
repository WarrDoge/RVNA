import { fail } from "@sveltejs/kit";
import {
	clearGitlabAccessToken,
	getGitlabSettings,
	gitlabBaseUrlBody,
	gitlabTokenBody,
	saveGitlabAccessToken,
	saveGitlabBaseUrl,
} from "#lib/server/gitlab/routes.ts";
import { adminAction, adminLoad } from "#lib/server/http-svelte.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load = adminLoad(async (event, actor) => {
	event.depends("app:gitlab-settings");
	return { settings: await getGitlabSettings(actor) };
}) satisfies PageServerLoad;

function message(error: { issues: { message: string }[] }) {
	return error.issues[0]?.message ?? "Invalid value";
}

export const actions = {
	default: adminAction(async ({ form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (intent === "saveBaseUrl") {
			const parsed = gitlabBaseUrlBody.safeParse({
				baseUrl: String(form.get("baseUrl") ?? "").trim(),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await saveGitlabBaseUrl(actor, parsed.data);
			return { ok: true, saved: "baseUrl" };
		}

		if (intent === "saveToken") {
			const parsed = gitlabTokenBody.safeParse({
				token: String(form.get("token") ?? ""),
			});
			if (!parsed.success) return fail(400, { error: message(parsed.error) });
			await saveGitlabAccessToken(actor, parsed.data);
			return { ok: true, saved: "token" };
		}

		if (intent === "removeToken") {
			await clearGitlabAccessToken(actor);
			return { ok: true, saved: "tokenRemoved" };
		}

		return fail(400, { error: "Unknown action" });
	}),
} satisfies Actions;
