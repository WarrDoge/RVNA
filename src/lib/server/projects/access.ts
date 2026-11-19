import type { CurrentUser } from "../auth.ts";
import { HttpError } from "../http.ts";
import {
	can,
	issuePermissionContext,
	type PermissionKey,
	permissionDenied,
	projectForId,
} from "../permissions.ts";

/** The permission check of every project route. */
export async function requireProjectPermission(
	actor: CurrentUser,
	projectId: string,
	permission: PermissionKey,
) {
	const project = await projectForId(projectId);
	if (!project) throw new HttpError(404, "Project not found");
	if (!(await can(actor, "BROWSE_PROJECTS", project))) {
		throw new HttpError(404, "Project not found");
	}
	if (!(await can(actor, permission, project))) {
		throw new HttpError(403, permissionDenied(permission));
	}
	return project;
}

/** The permission check of every issue route. */
export async function requireIssuePermission(
	actor: CurrentUser,
	keyOrId: string,
	permission: PermissionKey,
) {
	const context = await issuePermissionContext(keyOrId);
	if (!context) throw new HttpError(404, "Issue not found");
	if (!(await can(actor, "BROWSE_PROJECTS", context.project, context))) {
		throw new HttpError(404, "Issue not found");
	}
	if (!(await can(actor, permission, context.project, context))) {
		throw new HttpError(403, permissionDenied(permission));
	}
	return context;
}
