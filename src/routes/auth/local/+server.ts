import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions } from "#lib/server/auth.ts";
import { endpoint, jsonResponse } from "#lib/server/http.ts";
import { loginLocal } from "#lib/server/local-auth.ts";

const loginBody = z.object({
	username: z.string().trim().min(1).max(254),
	password: z.string().min(1).max(1024),
	returnTo: z.string().max(2048).optional(),
});

const response = z.object({
	redirect: z.string(),
	mustChangePassword: z.boolean(),
});

const login = endpoint(
	{ auth: "none", body: loginBody, response },
	async ({ body, event }) => {
		const result = await loginLocal({
			...body,
			ip: event.getClientAddress(),
			previousSessionId: event.cookies.get(SESSION_COOKIE),
		});
		event.cookies.set(SESSION_COOKIE, result.session, sessionCookieOptions());
		return {
			redirect: result.redirect,
			mustChangePassword: result.mustChangePassword,
		};
	},
);

// A sign-in without a session cookie passes `handle`, so this route asks for the header itself,
// before the body is validated.
export const POST: RequestHandler = (event) => {
	if (!event.request.headers.get("x-requested-with")) {
		return jsonResponse(
			{ error: "Missing X-Requested-With header" },
			{ status: 403 },
		);
	}
	return login(event);
};
