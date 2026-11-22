import { isRedirect, redirect } from "@sveltejs/kit";
import type { Handle, ServerInit } from "@sveltejs/kit/hooks";
import { sequence } from "@sveltejs/kit/hooks";
import { type DateContext, setDateProvider } from "#lib/dates.ts";
import {
	requestPath,
	SESSION_COOKIE,
	userForSession,
	userForToken,
} from "#lib/server/auth.ts";
import { env } from "#lib/server/env.ts";
import { jsonResponse } from "#lib/server/http.ts";
import {
	passwordPage,
	passwordPagePath,
	passwordTab,
} from "#lib/server/http-svelte.ts";
import { withPermissionData } from "#lib/server/permissions.ts";
import { skipsSessionGuard } from "#lib/server/public-routes.ts";
import {
	dateContext,
	runWithDateContext,
	runWithRequestCache,
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
	return runWithRequestCache(() =>
		runWithDateContext(context, () => resolve(event)),
	);
};

function applySecurityHeaders(response: Response, signedIn: boolean) {
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("X-Frame-Options", "SAMEORIGIN");
	response.headers.set("Referrer-Policy", "same-origin");
	// An API answer or a signed-in page holds one person's data; no cache may keep it.
	const type = response.headers.get("content-type");
	if (
		(type?.startsWith("application/json") ||
			(type?.startsWith("text/html") && signedIn)) &&
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
}

/**
 * Page responses also carry the Content-Security-Policy of `vite.config.ts`.
 * Exported for the tests, like `sessionHandle`.
 */
export const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	let response: Response;
	try {
		response = await resolve(event);
	} catch (cause) {
		if (!isRedirect(cause)) throw cause;
		// A hook may throw `redirect()`; SvelteKit would turn it into a response
		// outside this hook, where the security headers would be lost.
		response = new Response(null, {
			status: cause.status,
			headers: { location: cause.location },
		});
	}
	try {
		applySecurityHeaders(response, Boolean(event.locals.user));
		return response;
	} catch {
		// `Response.redirect()` and `fetch` answers have read-only headers; clone one
		// so the security headers still apply.
		const writable = new Response(response.body, response);
		applySecurityHeaders(writable, Boolean(event.locals.user));
		return writable;
	}
};

const mutating = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const passwordChangeAllowed = new Set(["GET /api/me", "POST /api/me/password"]);
/** The forced-change target itself must stay reachable instead of redirecting to itself. */
function isPasswordPage(url: URL) {
	return (
		requestPath(url.pathname) === passwordPagePath &&
		url.searchParams.get("selectedTab") === passwordTab
	);
}

function isDataPath(pathname: string) {
	return (
		pathname.startsWith("/api/") ||
		pathname.startsWith("/rest/") ||
		pathname.startsWith("/auth/")
	);
}

/** An enhanced form POST expects an action result, not the redirect response itself. */
function isActionJsonRequest(request: Request) {
	return (
		request.method === "POST" &&
		request.headers.get("accept")?.includes("application/json") === true
	);
}

function csrfGuard(event: Parameters<Handle>[0]["event"], bearer: boolean) {
	if (!mutating.has(event.request.method) || bearer) return null;
	const pathname = requestPath(event.url.pathname);

	if (isDataPath(pathname)) {
		if (
			event.cookies.get(SESSION_COOKIE) &&
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
	let user: App.Locals["user"];
	try {
		user = bearer
			? await userForToken(bearer)
			: await userForSession(event.cookies.get(SESSION_COOKIE));
	} catch (cause) {
		if (!isDataPath(requestPath(event.url.pathname))) throw cause;
		console.error(cause);
		return jsonResponse({ error: "Internal server error" }, { status: 500 });
	}
	event.locals.user = user;

	const blocked = csrfGuard(event, Boolean(bearer));
	if (blocked) return blocked;

	if (user?.mustChangePassword) {
		const pathname = requestPath(event.url.pathname);
		const method =
			event.request.method === "HEAD" ? "GET" : event.request.method;
		const key = `${method} ${event.route.id ?? pathname}`;
		if (bearer) {
			if (!passwordChangeAllowed.has(key)) {
				return jsonResponse(
					{ error: "Password change required" },
					{ status: 403 },
				);
			}
		} else if (isDataPath(pathname)) {
			if (!passwordChangeAllowed.has(key) && !pathname.startsWith("/auth/")) {
				return jsonResponse(
					{ error: "Password change required" },
					{ status: 403 },
				);
			}
		} else if (!isPasswordPage(event.url)) {
			if (isActionJsonRequest(event.request)) {
				return jsonResponse({
					type: "redirect",
					status: 302,
					location: passwordPage,
				});
			}
			redirect(302, passwordPage);
		}
	}

	return resolve(event);
};

const handleRequest = sequence(
	securityHeadersHandle,
	dateContextHandle,
	sessionHandle,
);

export const handle: Handle = (input) =>
	withPermissionData(() => handleRequest(input));

process.once("sveltekit:shutdown", stop);
