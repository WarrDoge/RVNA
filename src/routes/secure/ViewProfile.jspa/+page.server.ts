import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { SESSION_COOKIE, sessionCookieOptions } from "#lib/server/auth.ts";
import { HttpError, isBearer, isHttpError } from "#lib/server/http.ts";
import { pageAction, pageLoad } from "#lib/server/http-svelte.ts";
import { changePassword } from "#lib/server/local-auth.ts";
import { me } from "#lib/server/me/service.ts";
import { messengerProfileInfo } from "#lib/server/messenger/links.ts";
import {
	getNotificationSettings,
	updateNotificationSettings,
} from "#lib/server/notifications.ts";
import { userProfile } from "#lib/server/profile.ts";
import {
	createToken as createApiToken,
	listTokens,
	revokeToken as revokeApiToken,
	tokenCreateSchema,
} from "#lib/server/tokens/service.ts";
import type { Actions, PageServerLoad } from "./$types";

const MIN_PASSWORD_LENGTH = 12;

export const load = pageLoad(async (event, actor) => {
	const selectedTab = event.url.searchParams.get("selectedTab");
	if (isBearer(event.request) && selectedTab === "tokens") {
		throw new HttpError(403, "Bearer tokens cannot manage tokens");
	}
	const username = event.url.searchParams.get("name") ?? actor.username;

	const meView = me(actor);
	const profile = await userProfile(actor, username);
	const self = profile.isSelf;
	let tab: "tokens" | "notifications" | "password" | null = null;
	if (self) {
		if (selectedTab === "tokens") tab = "tokens";
		else if (selectedTab === "notifications") tab = "notifications";
		else if (selectedTab === "password" && meView.hasPassword) {
			tab = "password";
		}
	}

	event.depends("app:profile");
	event.depends("app:tokens");

	const [tokens, settings, messenger] = await Promise.all([
		self && tab === "tokens" ? listTokens(actor) : Promise.resolve([]),
		self && tab === "notifications"
			? getNotificationSettings(actor)
			: Promise.resolve(null),
		self ? messengerProfileInfo(actor) : Promise.resolve(null),
	]);

	return {
		me: meView,
		profile,
		tab,
		create: self && tab === "tokens" && event.url.searchParams.has("create"),
		tokens,
		settings,
		messenger,
	};
}) satisfies PageServerLoad;

export const actions = {
	default: pageAction(async ({ event, form }, actor) => {
		const intent = String(form.get("intent") ?? "");

		if (actor.mustChangePassword && intent !== "changePassword") {
			throw new HttpError(403, "Password change required");
		}
		if (
			(intent === "createToken" || intent === "revokeToken") &&
			isBearer(event.request)
		) {
			throw new HttpError(403, "Bearer tokens cannot manage tokens");
		}

		if (intent === "changePassword") {
			const currentPassword = String(form.get("currentPassword") ?? "");
			const newPassword = String(form.get("newPassword") ?? "");
			const confirmPassword = String(form.get("confirmPassword") ?? "");

			if (currentPassword === "") {
				return fail(400, {
					intent: "changePassword",
					error: "Enter your current password",
				});
			}
			if ([...newPassword].length < MIN_PASSWORD_LENGTH) {
				return fail(400, {
					intent: "changePassword",
					error: `The new password must be at least ${MIN_PASSWORD_LENGTH} characters long`,
				});
			}
			if (newPassword !== confirmPassword) {
				return fail(400, {
					intent: "changePassword",
					error: "The new passwords do not match",
				});
			}

			try {
				const session = await changePassword(actor, {
					currentPassword,
					newPassword,
					ip: event.getClientAddress(),
					sessionId: event.cookies.get(SESSION_COOKIE),
				});
				if (session) {
					event.cookies.set(SESSION_COOKIE, session, sessionCookieOptions());
				}
			} catch (cause) {
				if (isHttpError(cause) && cause.status === 429) {
					return fail(429, {
						intent: "changePassword",
						error: "Too many failed attempts. Try again in a few minutes.",
					});
				}
				throw cause;
			}
			event.locals.user = { ...actor, mustChangePassword: false };
			return { intent: "changePassword", changed: true };
		}

		if (intent === "createToken") {
			const rawDays = String(form.get("expiresInDays") ?? "").trim();
			const parsed = tokenCreateSchema.safeParse({
				name: form.get("name"),
				expiresInDays:
					rawDays === ""
						? undefined
						: rawDays === "never"
							? null
							: Number(rawDays),
				currentPassword: String(form.get("currentPassword") ?? ""),
			});
			if (!parsed.success) {
				return fail(400, {
					intent: "createToken",
					error: parsed.error.issues[0]?.message ?? "Invalid token",
				});
			}
			return {
				intent: "createToken",
				created: await createApiToken(
					actor,
					parsed.data,
					event.getClientAddress(),
				),
			};
		}

		if (intent === "revokeToken") {
			const parsed = z.uuid().safeParse(form.get("id"));
			if (!parsed.success) {
				return fail(400, {
					intent: "revokeToken",
					error: "Invalid token",
				});
			}
			await revokeApiToken(actor, parsed.data);
			return { intent: "revokeToken", revoked: parsed.data };
		}

		if (intent === "saveNotifications") {
			const saved = await updateNotificationSettings(actor, {
				emailNotifications: form.has("emailNotifications"),
				notifyOwnChanges: form.has("notifyOwnChanges"),
				autoWatch: form.has("autoWatch"),
				emailFormat: form.get("emailFormat") === "text" ? "text" : "html",
			});
			return { intent: "saveNotifications", saved };
		}

		return fail(400, { intent: "unknown", error: "Unknown action" });
	}),
} satisfies Actions;
