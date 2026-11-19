/**
 * Data routes that `handle` in `src/hooks.server.ts` lets through without a session lookup and
 * without the CSRF check, because the caller is not a browser and the endpoint authenticates the
 * request itself. This is the one list: add a route here only for such a caller, and add it to the
 * `PUBLIC` list of `test/auth-default-deny.test.ts` (a test compares the two).
 * Keys are SvelteKit route ids.
 */
export const selfAuthenticatedRoutes = [
	{
		method: "POST",
		routeId: "/api/integrations/gitlab/webhook",
		reason: "GitLab sends it with its own secret token header",
	},
] as const;

/**
 * Liveness answers before the session lookup and the password gate, outside any guard:
 * they must work when the database is down. Public routes like the others, with their own
 * entries in the `PUBLIC` list of the default-deny test.
 */
export const livenessRouteIds = ["/api/health", "/api/health/live"] as const;

export function skipsSessionGuard(method: string, routeId: string | null) {
	if (!routeId) return false;
	const normalized = method === "HEAD" ? "GET" : method;
	if (
		normalized === "GET" &&
		(livenessRouteIds as readonly string[]).includes(routeId)
	)
		return true;
	return selfAuthenticatedRoutes.some(
		(route) => route.method === normalized && route.routeId === routeId,
	);
}
