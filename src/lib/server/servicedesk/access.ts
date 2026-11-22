import { and, eq, type SQL, sql } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import {
	asPermissionUser,
	can,
	portalAccess,
	type ViewerLike,
} from "../permissions.ts";
import {
	comments,
	issues,
	projects,
	requestTypes,
	serviceDesks,
	watchers,
} from "../schema.ts";

export interface Desk {
	id: string;
	projectId: string;
	projectKey: string;
	projectName: string;
	portalName: string;
	description: string | null;
	announcement: string | null;
	openAccess: boolean;
	leadId: string | null;
}

const deskColumns = {
	id: serviceDesks.id,
	projectId: serviceDesks.projectId,
	projectKey: projects.key,
	projectName: projects.name,
	portalName: serviceDesks.portalName,
	description: serviceDesks.description,
	announcement: serviceDesks.announcement,
	openAccess: serviceDesks.openAccess,
	leadId: projects.leadId,
};

export async function listDesks(): Promise<Desk[]> {
	return db
		.select(deskColumns)
		.from(serviceDesks)
		.innerJoin(projects, eq(projects.id, serviceDesks.projectId))
		.orderBy(projects.key);
}

export async function deskByPortalId(id: string): Promise<Desk | null> {
	const [row] = await db
		.select(deskColumns)
		.from(serviceDesks)
		.innerJoin(projects, eq(projects.id, serviceDesks.projectId))
		.where(eq(serviceDesks.id, id))
		.limit(1);
	return row ?? null;
}

export async function deskByProjectId(projectId: string): Promise<Desk | null> {
	// The importer writes one desk per project; the order keeps a database that
	// holds more than one picking the same desk on every check.
	const [row] = await db
		.select(deskColumns)
		.from(serviceDesks)
		.innerJoin(projects, eq(projects.id, serviceDesks.projectId))
		.where(eq(serviceDesks.projectId, projectId))
		.orderBy(serviceDesks.id)
		.limit(1);
	return row ?? null;
}

export async function deskByProjectKey(key: string): Promise<Desk | null> {
	const [row] = await db
		.select(deskColumns)
		.from(serviceDesks)
		.innerJoin(projects, eq(projects.id, serviceDesks.projectId))
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	return row ?? null;
}

/** Agents are the people who work the desk: administrators and holders of SERVICEDESK_AGENT. */
export async function isAgent(user: ViewerLike, desk: Desk): Promise<boolean> {
	if (user.isAdmin) return true;
	return can(asPermissionUser(user), "SERVICEDESK_AGENT", {
		id: desk.projectId,
		key: desk.projectKey,
		leadId: desk.leadId,
	});
}

/**
 * Who may open the portal and raise requests: everyone signed in while the desk
 * has open access, else agents, holders of CREATE_ISSUES, and the desk's customers.
 */
export async function canRaiseRequests(
	user: ViewerLike,
	desk: Desk,
): Promise<boolean> {
	if (desk.openAccess) return true;
	if (await isAgent(user, desk)) return true;
	const viewer = asPermissionUser(user);
	const project = {
		id: desk.projectId,
		key: desk.projectKey,
		leadId: desk.leadId,
	};
	return (
		(await can(viewer, "CREATE_ISSUES", project)) ||
		(await portalAccess(viewer, project))
	);
}

/** Whether the user works the desk the project belongs to. */
export async function isAgentForProject(
	user: CurrentUser,
	projectId: string,
): Promise<boolean> {
	const desk = await deskByProjectId(projectId);
	return desk !== null && (await isAgent(user, desk));
}

/**
 * The projects whose desk the user works: the internal-comment rule of
 * isAgentForProject in a form SQL readers can use.
 */
export async function agentProjectIds(user: ViewerLike): Promise<string[]> {
	const desks = await listDesks();
	const result: string[] = [];
	for (const desk of desks) {
		if (await isAgent(user, desk)) result.push(desk.projectId);
	}
	return result;
}

/**
 * The internal-comment rule as SQL: a comment is readable when it is public,
 * or when the viewer works the issue's project. A null viewer is an internal
 * job, which reads every comment.
 */
export function readableCommentCondition(
	internal: SQL,
	projectId: SQL,
	agentProjects: string[] | null,
): SQL {
	if (agentProjects === null) return sql`true`;
	return sql`(${internal} = false or ${projectId} = any(${sql.param(agentProjects)}::uuid[]))`;
}

/** A customer sees a request they raised, watch or commented on. */
export async function isParticipant(
	userId: string,
	issueId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ found: sql<number>`1` })
		.from(watchers)
		.where(and(eq(watchers.issueId, issueId), eq(watchers.userId, userId)))
		.union(
			db
				.select({ found: sql<number>`1` })
				.from(comments)
				.where(
					and(eq(comments.issueId, issueId), eq(comments.authorId, userId)),
				),
		)
		.limit(1);
	return row !== undefined;
}

export async function canViewRequest(
	user: CurrentUser,
	desk: Desk,
	issue: {
		id: string;
		projectId: string;
		requestTypeId: string | null;
		reporterId: string | null;
		creatorId: string | null;
	},
): Promise<boolean> {
	// An ordinary issue in the desk's project is not a portal request.
	if (issue.projectId !== desk.projectId || !issue.requestTypeId) return false;
	if (await isAgent(user, desk)) return true;
	if (issue.reporterId === user.id || issue.creatorId === user.id) return true;
	return isParticipant(user.id, issue.id);
}

/**
 * Whether the user may read a portal request's attachments: anyone the portal
 * request page admits, by the same check. Non-portal issues are not covered.
 */
export async function canViewRequestIssue(
	user: CurrentUser,
	issueId: string,
): Promise<boolean> {
	const [issue] = await db
		.select({
			id: issues.id,
			projectId: issues.projectId,
			reporterId: issues.reporterId,
			creatorId: issues.creatorId,
			requestTypeId: issues.requestTypeId,
			requestTypeDeskId: requestTypes.deskId,
		})
		.from(issues)
		.innerJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.where(eq(issues.id, issueId))
		.limit(1);
	if (!issue) return false;
	const desk = await deskByProjectId(issue.projectId);
	if (!desk || issue.requestTypeDeskId !== desk.id) return false;
	return canViewRequest(user, desk, issue);
}

/** Issue ids a customer participates in, for the "my requests" filters. */
export async function participatingIssueIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ issueId: watchers.issueId })
		.from(watchers)
		.where(eq(watchers.userId, userId))
		.union(
			db
				.select({ issueId: comments.issueId })
				.from(comments)
				.where(eq(comments.authorId, userId)),
		);
	return rows.map((row) => row.issueId);
}

/**
 * Where a signed-in user who may not browse an issue is sent when the request
 * admits them: the customer view of it, as Jira does. That includes the reporter,
 * the creator, watchers, commenters and desk agents. Anyone else gets null and
 * the usual not-found screen.
 */
export async function customerRequestPath(
	user: CurrentUser,
	key: string,
): Promise<string | null> {
	const [issue] = await db
		.select({
			id: issues.id,
			key: issues.key,
			projectId: issues.projectId,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
			creatorId: issues.creatorId,
			requestTypeId: issues.requestTypeId,
			requestTypeDeskId: requestTypes.deskId,
		})
		.from(issues)
		.innerJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) return null;
	const desk = await deskByProjectId(issue.projectId);
	if (!desk || issue.requestTypeDeskId !== desk.id) return null;
	const project = {
		id: desk.projectId,
		key: desk.projectKey,
		leadId: desk.leadId,
	};
	if (await can(asPermissionUser(user), "BROWSE_PROJECTS", project, issue)) {
		return null;
	}
	if (!(await canViewRequest(user, desk, issue))) return null;
	return `/servicedesk/customer/portal/${desk.id}/${issue.key}`;
}

/**
 * The reporter of a service desk request who may not browse the desk's project:
 * the one person outside the desk's staff who attaches files to the request and
 * downloads them. Nobody else, and no other issue of the project.
 */
export async function isRequester(
	user: CurrentUser,
	issueId: string,
): Promise<boolean> {
	const [issue] = await db
		.select({
			id: issues.id,
			projectId: issues.projectId,
			reporterId: issues.reporterId,
			assigneeId: issues.assigneeId,
			requestTypeId: issues.requestTypeId,
		})
		.from(issues)
		.where(eq(issues.id, issueId))
		.limit(1);
	if (!issue?.requestTypeId || issue.reporterId !== user.id) {
		return false;
	}
	const desk = await deskByProjectId(issue.projectId);
	if (!desk) return false;
	const project = {
		id: desk.projectId,
		key: desk.projectKey,
		leadId: desk.leadId,
	};
	return !(await can(
		asPermissionUser(user),
		"BROWSE_PROJECTS",
		project,
		issue,
	));
}
