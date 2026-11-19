import { redirect } from "@sveltejs/kit";
import type { Handle, ServerInit } from "@sveltejs/kit/hooks";
import { sequence } from "@sveltejs/kit/hooks";
import { type DateContext, setDateProvider } from "#lib/dates.ts";
import { requestPath, userForSession, userForToken } from "#lib/server/auth.ts";
import { env } from "#lib/server/env.ts";
import { jsonResponse } from "#lib/server/http.ts";
import { passwordPage } from "#lib/server/http-svelte.ts";
import { skipsSessionGuard } from "#lib/server/public-routes.ts";
import {
	dateContext,
	runWithDateContext,
} from "#lib/server/request-context.ts";
import { start, stop } from "#lib/server/runtime.ts";

export const init: ServerInit = start;

setDateProvider(dateContext);

const fallbackTimeZone = "UTC";
const fallbackLocale = "en-GB";

function canonicalTimeZone(value: string | null | undefined) {
	if (!value) return null;
	try {
		return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
			.timeZone;
	} catch {
		return null;
	}
}

function canonicalLocale(value: string | null | undefined) {
	if (!value) return null;
	try {
		return Intl.DateTimeFormat.supportedLocalesOf([value])[0] ?? null;
	} catch {
		return null;
	}
}

/** The first supported language of Accept-Language. */
function acceptLanguageLocale(header: string | null) {
	if (!header) return null;
	for (const item of header.split(",")) {
		const locale = canonicalLocale(item.split(";")[0]?.trim());
		if (locale) return locale;
	}
	return null;
}

function dateContextFor(event: Parameters<Handle>[0]["event"]): DateContext {
	const timeZone = [event.cookies.get("tz"), env.APP_TIME_ZONE]
		.map(canonicalTimeZone)
		.find((value): value is string => value !== null);
	const locale = [
		event.cookies.get("locale"),
		acceptLanguageLocale(event.request.headers.get("accept-language")),
	]
		.map(canonicalLocale)
		.find((value): value is string => value !== null);

	return {
		timeZone:
			timeZone ?? canonicalTimeZone(fallbackTimeZone) ?? fallbackTimeZone,
		locale: locale ?? fallbackLocale,
		now: Date.now(),
	};
}

const dateContextHandle: Handle = ({ event, resolve }) => {
	const context = dateContextFor(event);
	return runWithDateContext(context, () => resolve(event));
};

/** Page responses also carry the Content-Security-Policy of `vite.config.ts`. */
const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	try {
		response.headers.set("X-Content-Type-Options", "nosniff");
		response.headers.set("X-Frame-Options", "SAMEORIGIN");
		response.headers.set("Referrer-Policy", "same-origin");
		// An answer from the API holds one person's data; no cache may keep it.
		if (
			response.headers.get("content-type")?.startsWith("application/json") &&
			!response.headers.has("Cache-Control")
		) {
			response.headers.set("Cache-Control", "no-store");
		}
		if (env.APP_URL.startsWith("https://")) {
			response.headers.set(
				"Strict-Transport-Security",
				"max-age=31536000; includeSubDomains",
			);
		}
	} catch {
		// A response made by `Response.redirect()` or `fetch` has read-only headers.
	}
	return response;
};

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const passwordChangeAllowed = new Set(["GET /api/me", "POST /api/me/password"]);
const profilePage = "/secure/ViewProfile.jspa";

/** The forced-change target itself must stay reachable instead of redirecting to itself. */
function isPasswordPage(url: URL) {
	return (
		requestPath(url.pathname) === profilePage &&
		url.searchParams.get("selectedTab") === "password"
	);
}

function isDataPath(pathname: string) {
	return (
		pathname.startsWith("/api/") ||
		pathname.startsWith("/rest/") ||
		pathname.startsWith("/auth/")
	);
}

function csrfGuard(event: Parameters<Handle>[0]["event"], bearer: boolean) {
	if (!mutating.has(event.request.method) || bearer) return null;
	const pathname = requestPath(event.url.pathname);

	if (isDataPath(pathname)) {
		if (
			event.cookies.get("sid") &&
			!event.request.headers.get("x-requested-with")
		) {
			return jsonResponse(
				{ error: "Missing X-Requested-With header" },
				{ status: 403 },
			);
		}
		return null;
	}

	if (event.request.headers.get("origin") === event.url.origin) return null;
	return new Response("Cross-site POST form submissions are forbidden", {
		status: 403,
	});
}

/** Exported for the tests: `sequence` needs SvelteKit's request store, which a fake event lacks. */
export const sessionHandle: Handle = async ({ event, resolve }) => {
	if (skipsSessionGuard(event.request.method, event.route.id)) {
		return resolve(event);
	}

	// No route answers: a data path says so in JSON, any other address gets the not-found page.
	if (event.route.id === null && isDataPath(requestPath(event.url.pathname))) {
		return jsonResponse({ error: "Not found" }, { status: 404 });
	}

	const bearer = event.request.headers
		.get("authorization")
		?.match(/^Bearer (.+)$/i)?.[1];
	event.locals.user = bearer
		? await userForToken(bearer)
		: await userForSession(event.cookies.get("sid"));

	const blocked = csrfGuard(event, Boolean(bearer));
	if (blocked) return blocked;

	const user = event.locals.user;
	if (user?.mustChangePassword && !bearer) {
		const pathname = requestPath(event.url.pathname);
		const method =
			event.request.method === "HEAD" ? "GET" : event.request.method;
		const key = `${method} ${event.route.id ?? pathname}`;
		if (isDataPath(pathname)) {
			if (!passwordChangeAllowed.has(key) && !pathname.startsWith("/auth/")) {
				return jsonResponse(
					{ error: "Password change required" },
					{ status: 403 },
				);
			}
		} else if (!isPasswordPage(event.url)) {
			redirect(302, passwordPage);
		}
	}

	return resolve(event);
};

export const handle = sequence(
	securityHeadersHandle,
	dateContextHandle,
	sessionHandle,
);

process.once("sveltekit:shutdown", stop);
