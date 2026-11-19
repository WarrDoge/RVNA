import { randomUUID } from "node:crypto";
import { manifest } from "../build/server/manifest.js";

export type AppRoute = {
	method: string;
	/** Pattern with :key, :id, ... for each route parameter. */
	pattern: string;
	kind: "endpoint" | "page";
	routeId?: string;
	/** True for a route with a `+page.svelte`: it authenticates through `pageLoad` or `adminLoad`. */
	page?: boolean;
	/** Page POST routes only: the names of the form actions (`default` or `?/name`). */
	actions?: string[];
};

const endpointMethods = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"HEAD",
];

/** The same rule as `handle`: data paths answer 401, every other path is a browser address. */
function isDataPath(pattern: string) {
	return (
		pattern.startsWith("/api/") ||
		pattern.startsWith("/rest/") ||
		pattern.startsWith("/auth/")
	);
}

function toPattern(routeId: string) {
	const path = routeId
		.split("/")
		.filter((segment) => segment !== "" && !/^\(.+\)$/.test(segment))
		.join("/");
	return `/${path}`.replace(/\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}/g, ":$1");
}

/**
 * The names of the actions a `+page.server` module exports, however the export is
 * written (`export const`, `export { actions }`, `export *`): the module itself
 * is asked, not its source.
 */
export function actionNames(serverModule: unknown): string[] {
	const actions = (serverModule as { actions?: unknown } | null | undefined)
		?.actions;
	return actions !== null && typeof actions === "object"
		? Object.keys(actions)
		: [];
}

/** Every route the app answers: SvelteKit's route ids, exported methods and page actions, from the built manifest. */
export async function allAppRoutes(): Promise<AppRoute[]> {
	const routes = new Map<string, AppRoute>();
	for (const route of manifest.routes as {
		id: string;
		page: { leaf: number } | null;
		endpoint: (() => Promise<Record<string, unknown>>) | null;
	}[]) {
		const pattern = toPattern(route.id);
		if (route.endpoint) {
			const module = await route.endpoint();
			const methods = endpointMethods.filter(
				(method) => typeof module[method] === "function",
			);
			if (methods.includes("GET") && !methods.includes("HEAD"))
				methods.push("HEAD");
			for (const method of methods) {
				routes.set(`${method} ${pattern}`, {
					method,
					pattern,
					kind: isDataPath(pattern) ? "endpoint" : "page",
					routeId: route.id,
				});
			}
			continue;
		}

		if (route.page) {
			for (const method of ["GET", "HEAD"]) {
				routes.set(`${method} ${pattern}`, {
					method,
					pattern,
					kind: "page",
					routeId: route.id,
					page: true,
				});
			}
			const node = await (
				manifest.nodes as (() => Promise<{ server?: unknown }>)[]
			)[route.page.leaf]();
			const actions = actionNames(node.server);
			if (actions.length > 0) {
				routes.set(`POST ${pattern}`, {
					method: "POST",
					pattern,
					kind: "page",
					routeId: route.id,
					page: true,
					actions,
				});
			}
		}
	}

	return [...routes.values()];
}

export function routeKey(route: AppRoute) {
	return `${route.method} ${route.pattern}`;
}

/** The addresses a browser form posts to for each action of a page POST route. */
export function actionUrls(route: AppRoute, url: string) {
	return (route.actions ?? ["default"]).map((name) =>
		name === "default" ? url : `${url}?/${name}`,
	);
}

const samples: Record<string, string> = {
	key: "TEST-1",
	issueKey: "TEST-1",
	username: "dev",
	fileName: "file.txt",
	rapidViewId: "1",
	sourceId: "10001",
	issueId: "10001",
	pageId: "10001",
};

/** Fill route parameters with plausible values; callers can override fixture ids. */
export function concreteRoute(
	pattern: string,
	overrides: Record<string, string> = {},
) {
	return pattern
		.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, name: string) => {
			return overrides[name] ?? samples[name] ?? randomUUID();
		})
		.replace(/\*/g, "x");
}
