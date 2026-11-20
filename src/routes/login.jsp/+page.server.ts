import { fail, redirect } from "@sveltejs/kit";
import { SESSION_COOKIE, sessionCookieOptions } from "#lib/server/auth.ts";
import { isHttpError } from "#lib/server/http.ts";
import { authConfig, loginLocal, loginSchema } from "#lib/server/local-auth.ts";
import { loginRedirectTarget } from "#lib/server/oidc.ts";
import type { Actions, PageServerLoad } from "./$types";

function waitText(seconds: number) {
	if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
	if (seconds < 60) {
		return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
	}
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export const load: PageServerLoad = async ({ url }) => {
	const returnTo = url.searchParams.get("returnTo") ?? "";
	const local = url.searchParams.get("local") === "1";
	const config = authConfig();

	const target = loginRedirectTarget({
		returnTo: returnTo || undefined,
		local: local ? "1" : undefined,
	});
	if (!local && (target || config.devLogin)) {
		redirect(
			302,
			target ??
				`/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
		);
	}

	return { config, returnTo };
};

export const actions = {
	default: async ({ request, url, cookies, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get("username") ?? "").trim();
		const password = String(form.get("password") ?? "");
		const returnTo =
			String(form.get("returnTo") ?? url.searchParams.get("returnTo") ?? "") ||
			undefined;

		if (username === "" || password === "") {
			return fail(400, {
				error: "Enter your username and password.",
				username,
			});
		}

		const parsed = loginSchema.safeParse({ username, password, returnTo });
		if (!parsed.success) {
			return fail(400, {
				error:
					parsed.error.issues[0]?.message ?? "Invalid username or password",
				username,
			});
		}

		try {
			const result = await loginLocal({
				...parsed.data,
				ip: getClientAddress(),
				previousSessionId: cookies.get(SESSION_COOKIE),
			});
			cookies.set(SESSION_COOKIE, result.session, sessionCookieOptions());
			redirect(303, result.redirect);
		} catch (cause) {
			if (isHttpError(cause)) {
				if (cause.status === 429) {
					const retryAfter = new Headers(cause.headers).get("retry-after");
					return fail(429, {
						error: `Too many failed attempts. Try again in ${waitText(
							Number(retryAfter),
						)}.`,
						username,
					});
				}
				return fail(cause.status, { error: cause.message, username });
			}
			throw cause;
		}
	},
} satisfies Actions;
