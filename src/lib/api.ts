export class ApiError extends Error {
	status: number;
	/** The parsed JSON error body, or null when the response had none. */
	body: unknown;

	constructor(status: number, message: string, body: unknown = null) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

export function isLoginPath(path: string) {
	return path === "/login.jsp" || path === "/login";
}

/** The one client rule for an expired session: the page that shows the login form or SSO. */
export function redirectToLogin() {
	if (isLoginPath(window.location.pathname)) return;
	const returnTo = `${window.location.pathname}${window.location.search}`;
	window.location.assign(`/login.jsp?returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * The API's error body has a generic `error` and, for validation failures, the
 * detail in `message`; show the detail when there is one.
 */
export function errorMessageFromBody(parsed: unknown, fallback: string) {
	const body = parsed as { error?: unknown; message?: unknown } | null;
	if (typeof body?.message === "string" && body.message !== "") {
		return body.message;
	}
	if (typeof body?.error === "string") return body.error;
	return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	headers.set("X-Requested-With", "rvna");
	if (
		init.body !== undefined &&
		!(init.body instanceof FormData) &&
		!headers.has("Content-Type")
	) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(path, { ...init, headers });

	if (response.status === 401) {
		redirectToLogin();
		throw new ApiError(401, "Unauthorized");
	}

	if (!response.ok) {
		let parsed: unknown = null;
		try {
			parsed = await response.json();
		} catch {
			// The response body is not JSON; keep the status text.
		}
		throw new ApiError(
			response.status,
			errorMessageFromBody(parsed, response.statusText),
			parsed,
		);
	}

	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}
