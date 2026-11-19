import { eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db.ts";
import {
	attachments,
	boards,
	components,
	issueLinks,
	issues,
	projectPreviousKeys,
	projects,
	serviceDesks,
	sprints,
	versions,
} from "./schema.ts";

const issueKeyPattern = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
const uuidPattern = z.uuid();

/** Current key of the project that used `key` before, or null when `key` is current or unknown. */
async function currentKeyOf(key: string) {
	const upper = key.toUpperCase();
	const [current] = await db
		.select({ key: projects.key })
		.from(projects)
		.where(eq(projects.key, upper))
		.limit(1);
	if (current) return null;

	const [previous] = await db
		.select({ key: projects.key })
		.from(projectPreviousKeys)
		.innerJoin(projects, eq(projects.id, projectPreviousKeys.projectId))
		.where(eq(projectPreviousKeys.key, upper))
		.limit(1);
	return previous?.key ?? null;
}

/** Rewrites a previous project key, or an issue key of one, to the current key. */
export async function resolvePreviousKey(value: string): Promise<string> {
	const issue = issueKeyPattern.exec(value);
	if (issue) {
		const [, prefix, number] = issue;
		const current = await currentKeyOf(prefix ?? "");
		return current ? `${current}-${number}` : value;
	}
	// Only undashed values can be project keys; anything else is left to the route.
	if (value.includes("-")) return value;
	const current = await currentKeyOf(value);
	return current ?? value;
}

type WriteRequest = {
	params?: unknown;
	body?: unknown;
};

function bodyProject(body: unknown) {
	if (body instanceof FormData) {
		const value = body.get("project");
		return typeof value === "string" ? value : null;
	}
	if (body && typeof body === "object" && "project" in body) {
		const value = (body as { project?: unknown }).project;
		return typeof value === "string" ? value : null;
	}
	return null;
}

function setBodyProject(body: unknown, value: string) {
	if (body instanceof FormData) {
		body.set("project", value);
		return;
	}
	if (body && typeof body === "object" && "project" in body) {
		(body as { project: string }).project = value;
	}
}

/** Rewrites previous project keys in a parsed params/body pair, for endpoints and page actions. */
export async function resolvePreviousKeysFor(
	params: Record<string, unknown> | undefined,
	body: unknown,
) {
	if (params && typeof params.key === "string") {
		const resolved = await resolvePreviousKey(params.key);
		if (resolved !== params.key) params.key = resolved;
	}

	const project = bodyProject(body);
	if (project !== null) {
		const resolved = await resolvePreviousKey(project);
		if (resolved !== project) setBodyProject(body, resolved);
	}
}

/**
 * Where a mutating route finds the project it writes to. `issue`/`project` read
 * `params.key`; the rest read the row the route addresses.
 */
export type WriteScope =
	| { kind: "issue" }
	| { kind: "project" }
	| { kind: "body-project" }
	| { kind: "component" }
	| { kind: "version" }
	| { kind: "attachment" }
	| { kind: "issue-link" }
	| { kind: "board" }
	| { kind: "sprint" }
	| { kind: "portal" };

/** Every mutating route that belongs to a project, with the project it writes to. */
export const writeRouteScopes: Record<string, WriteScope> = {
	"POST /api/issues": { kind: "body-project" },
	"POST /api/issues/:key/clone": { kind: "issue" },
	"PATCH /api/issues/:key": { kind: "issue" },
	"DELETE /api/issues/:key": { kind: "issue" },
	"POST /api/issues/:key/transitions": { kind: "issue" },
	"POST /api/issues/:key/comments": { kind: "issue" },
	"PATCH /api/issues/:key/comments/:id": { kind: "issue" },
	"DELETE /api/issues/:key/comments/:id": { kind: "issue" },
	"POST /api/issues/:key/worklogs": { kind: "issue" },
	"DELETE /api/issues/:key/worklogs/:id": { kind: "issue" },
	"PUT /api/issues/:key/watch": { kind: "issue" },
	"POST /api/issues/:key/watchers": { kind: "issue" },
	"DELETE /api/issues/:key/watchers/:userId": { kind: "issue" },
	"DELETE /api/issues/:key/watch": { kind: "issue" },
	"POST /api/issues/:key/links": { kind: "issue" },
	"DELETE /api/issue-links/:id": { kind: "issue-link" },
	"POST /api/issues/:key/attachments": { kind: "issue" },
	"DELETE /api/attachments/:id": { kind: "attachment" },
	"PATCH /api/projects/:key": { kind: "project" },
	"POST /api/projects/:key/roles/:roleId/actors": { kind: "project" },
	"DELETE /api/projects/:key/roles/:roleId/actors/:actorId": {
		kind: "project",
	},
	"POST /api/projects/:key/components": { kind: "project" },
	"PATCH /api/components/:id": { kind: "component" },
	"DELETE /api/components/:id": { kind: "component" },
	"POST /api/projects/:key/versions": { kind: "project" },
	"PATCH /api/versions/:id": { kind: "version" },
	"DELETE /api/versions/:id": { kind: "version" },
	"PATCH /api/projects/:key/gitlab": { kind: "project" },
	"PATCH /api/servicedesk/projects/:key/settings": { kind: "project" },
	"POST /api/boards": { kind: "body-project" },
	"PATCH /api/boards/:rapidViewId": { kind: "board" },
	"DELETE /api/boards/:rapidViewId": { kind: "board" },
	"PUT /api/boards/:rapidViewId/columns": { kind: "board" },
	"PUT /api/boards/:rapidViewId/swimlanes": { kind: "board" },
	"PUT /api/boards/:rapidViewId/quick-filters": { kind: "board" },
	"POST /api/boards/:rapidViewId/move": { kind: "board" },
	"POST /api/boards/:rapidViewId/sprints": { kind: "board" },
	"PATCH /api/sprints/:id": { kind: "sprint" },
	"POST /api/sprints/:id/start": { kind: "sprint" },
	"POST /api/sprints/:id/complete": { kind: "sprint" },
	"DELETE /api/sprints/:id": { kind: "sprint" },
	"POST /api/sprints/:id/move": { kind: "sprint" },
	"POST /api/servicedesk/portals/:id/requests": { kind: "portal" },
	"POST /api/servicedesk/portals/:id/requests/:key/comments": { kind: "issue" },
	"POST /servicedesk/customer/portal/:id/create/:requestTypeId": {
		kind: "portal",
	},
	"POST /servicedesk/customer/portal/:id/:key": { kind: "issue" },
};

/** Prefixes whose mutating routes never write into a project. */
export const exemptWritePrefixes = [
	"/api/admin",
	"/plugins/servlet",
	"/auth",
	"/api/me",
	"/api/search",
	"/api/integrations",
	"/api/notifications",
	"/api/navigator",
	"/api/profile",
	"/api/filters",
	"/api/users",
	"/api/dashboards",
	"/api/wiki",
	"/api/gadgets",
];

export const mutatingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A view is user activity, not a project write, so archived projects still record it. */
export const exemptWriteRoutes = new Set(["/api/issues/:key/view"]);

export function isUnder(path: string, prefix: string) {
	return path === prefix || path.startsWith(`${prefix}/`);
}

export function isExemptWriteRoute(url: string) {
	return (
		exemptWriteRoutes.has(url) ||
		exemptWritePrefixes.some((prefix) => isUnder(url, prefix))
	);
}

function keyParam(request: WriteRequest) {
	const params = request.params as { key?: unknown; id?: unknown } | undefined;
	for (const value of [params?.key, params?.id]) {
		if (typeof value === "string") return value;
	}
	return "";
}

async function projectIdByKey(key: string) {
	if (key === "") return null;
	const [row] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return row?.id ?? null;
}

async function projectIdByIssueKey(key: string) {
	if (key === "") return null;
	const [row] = await db
		.select({ projectId: issues.projectId })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	return row?.projectId ?? null;
}

/** The project a mutating request writes to, or null when the route will answer 404 itself. */
export async function projectIdForWrite(
	request: WriteRequest,
	scope: WriteScope,
): Promise<string | null> {
	switch (scope.kind) {
		case "issue":
			return projectIdByIssueKey(keyParam(request));
		case "project":
			return projectIdByKey(keyParam(request));
		case "body-project":
			return projectIdByKey(bodyProject(request.body) ?? "");
		case "component":
		case "version": {
			const id = keyParam(request);
			if (!uuidPattern.safeParse(id).success) return null;
			const table = scope.kind === "component" ? components : versions;
			const [row] = await db
				.select({ projectId: table.projectId })
				.from(table)
				.where(eq(table.id, id))
				.limit(1);
			return row?.projectId ?? null;
		}
		case "attachment": {
			const id = keyParam(request);
			if (id === "") return null;
			const [row] = await db
				.select({ projectId: issues.projectId })
				.from(attachments)
				.innerJoin(issues, eq(issues.id, attachments.issueId))
				.where(
					uuidPattern.safeParse(id).success
						? or(eq(attachments.id, id), eq(attachments.sourceId, id))
						: eq(attachments.sourceId, id),
				)
				.limit(1);
			return row?.projectId ?? null;
		}
		case "board": {
			const params = request.params as { rapidViewId?: unknown } | undefined;
			const rapidViewId = Number(params?.rapidViewId);
			if (!Number.isInteger(rapidViewId)) return null;
			const [row] = await db
				.select({ projectId: boards.projectId })
				.from(boards)
				.where(eq(boards.rapidViewId, rapidViewId))
				.limit(1);
			return row?.projectId ?? null;
		}
		case "sprint": {
			const id = keyParam(request);
			if (!uuidPattern.safeParse(id).success) return null;
			const [row] = await db
				.select({ projectId: boards.projectId })
				.from(sprints)
				.innerJoin(boards, eq(boards.id, sprints.boardId))
				.where(eq(sprints.id, id))
				.limit(1);
			return row?.projectId ?? null;
		}
		case "portal": {
			const id = keyParam(request);
			if (!uuidPattern.safeParse(id).success) return null;
			const [row] = await db
				.select({ projectId: serviceDesks.projectId })
				.from(serviceDesks)
				.where(eq(serviceDesks.id, id))
				.limit(1);
			return row?.projectId ?? null;
		}
		case "issue-link": {
			const id = keyParam(request);
			if (!uuidPattern.safeParse(id).success) return null;
			const [row] = await db
				.select({ projectId: issues.projectId })
				.from(issueLinks)
				.innerJoin(issues, eq(issues.id, issueLinks.sourceIssueId))
				.where(eq(issueLinks.id, id))
				.limit(1);
			return row?.projectId ?? null;
		}
	}
}

/** SvelteKit route ids use [key]; the write table uses :key. */
export function routePattern(routeId: string) {
	return routeId.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, ":$1");
}

/** The archived-project answer for a parsed route, or null when the write is allowed. */
export async function rejectArchivedWriteFor(input: {
	method: string;
	route: string;
	params?: unknown;
	body?: unknown;
}): Promise<string | null> {
	if (!mutatingMethods.has(input.method)) return null;
	if (input.route === "" || isExemptWriteRoute(input.route)) return null;

	const scope = writeRouteScopes[`${input.method} ${input.route}`];
	if (!scope) return null;

	const projectId = await projectIdForWrite(input, scope);
	if (!projectId) return null;

	const [project] = await db
		.select({ archived: projects.archived })
		.from(projects)
		.where(eq(projects.id, projectId))
		.limit(1);
	return project?.archived ? "This project is archived and read-only" : null;
}
