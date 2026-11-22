import {
	type ActionFailure,
	error,
	fail,
	type RequestEvent,
	redirect,
	type ServerLoadEvent,
} from "@sveltejs/kit";
import { type CurrentUser, loginPath } from "./auth.ts";
import { isHttpError, prepareWrite } from "./http.ts";
import { requireAdminActor } from "./permissions.ts";
import { resolvePreviousKeysFor } from "./project-keys.ts";

const passwordPage = "/secure/ViewProfile.jspa?selectedTab=password";

/** One sign-in redirect for every moved page and action, keeping the return address. */
export function requirePageUser(event: {
	locals: App.Locals;
	url: URL;
}): CurrentUser {
	if (!event.locals.user) {
		redirect(302, loginPath(`${event.url.pathname}${event.url.search}`));
	}
	return event.locals.user;
}

/** Map a domain error to SvelteKit's load error, leaving unknown errors for handleError. */
export function loadError(cause: unknown): never {
	if (isHttpError(cause)) throw error(cause.status, cause.message);
	throw cause;
}

/** What a failed form action returns: the message, and the `details` of the `HttpError`. */
export type ActionError = { error: string; [detail: string]: unknown };

/** Map a domain error to a form action failure, leaving unknown errors for handleError. */
export function actionFailure(cause: unknown) {
	if (isHttpError(cause)) {
		const data: ActionError = { error: cause.message, ...cause.details };
		return fail(cause.status, data);
	}
	throw cause;
}

/**
 * The address with the `[key]` segment of the route set to `key`. The route id names the
 * segment; groups like `(app)` are not part of the address.
 */
function withKey(routeId: string, url: URL, key: string) {
	const template = routeId
		.split("/")
		.filter((segment) => !/^\(.*\)$/.test(segment));
	const segments = url.pathname.split("/");
	const index = template.findIndex((segment) =>
		/^\[key(=\w+)?\]$/.test(segment),
	);
	segments[index] = encodeURIComponent(key);
	return `${segments.join("/")}${url.search}`;
}

/**
 * A project key the project once had is a 302 to the same address with the current key,
 * as the project pages always answered.
 */
async function redirectPreviousKey(event: ServerLoadEvent) {
	if (typeof event.params.key !== "string" || !event.route.id) return;
	const params: Record<string, unknown> = { ...event.params };
	await resolvePreviousKeysFor(params, undefined);
	if (params.key !== event.params.key) {
		redirect(302, withKey(event.route.id, event.url, params.key as string));
	}
}

type LoadHandler<E, T> = (event: E, actor: CurrentUser) => T | Promise<T>;
type ActionHandler<E, T> = (
	input: { event: E; form: FormData },
	actor: CurrentUser,
) => T | Promise<T>;

function wrapLoad<E extends ServerLoadEvent, T>(
	handler: LoadHandler<E, T>,
	admin: boolean,
) {
	return async (event: E): Promise<T> => {
		const actor = requirePageUser(event);
		try {
			if (admin) requireAdminActor(actor);
		} catch (cause) {
			loadError(cause);
		}
		await redirectPreviousKey(event);
		try {
			return await handler(event, actor);
		} catch (cause) {
			loadError(cause);
		}
	};
}

function wrapAction<E extends RequestEvent, T>(
	handler: ActionHandler<E, T>,
	admin: boolean,
) {
	return async (event: E): Promise<T | ActionFailure<ActionError>> => {
		const actor = requirePageUser(event);
		try {
			if (admin) requireAdminActor(actor);
			const form = await event.request.formData();
			await prepareWrite(event, event.params, form);
			return await handler({ event, form }, actor);
		} catch (cause) {
			return actionFailure(cause);
		}
	};
}

/**
 * The only page-load wrapper: auth first, then domain errors become error(status, message).
 * `event` is the route's own typed event and the returned object types `PageData`.
 */
export function pageLoad<E extends ServerLoadEvent, T>(
	handler: LoadHandler<E, T>,
) {
	return wrapLoad(handler, false);
}

/** The load of an administration page: a signed-in user who is not an administrator gets a 403. */
export function adminLoad<E extends ServerLoadEvent, T>(
	handler: LoadHandler<E, T>,
) {
	return wrapLoad(handler, true);
}

/** The only form-action wrapper: auth, one formData read, write guards, then fail(status). */
export function pageAction<E extends RequestEvent, T>(
	handler: ActionHandler<E, T>,
) {
	return wrapAction(handler, false);
}

/** The form action of an administration page: a non-administrator gets `fail(403)`. */
export function adminAction<E extends RequestEvent, T>(
	handler: ActionHandler<E, T>,
) {
	return wrapAction(handler, true);
}

export { passwordPage };
