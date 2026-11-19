import { eq } from "drizzle-orm";
import { JqlError } from "../../shared/jql/index.ts";
import { audit } from "../admin/audit.ts";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import {
	requireIssuePermissionFor,
	requireProjectPermissionFor,
} from "../permissions.ts";
import { issues, requestTypes } from "../schema.ts";
import { serviceDesks } from "../schema-servicedesk.ts";
import {
	canRaiseRequests,
	deskByPortalId,
	deskByProjectId,
	deskByProjectKey,
	isAgent,
	listDesks,
} from "./access.ts";
import {
	addCustomerComment,
	createRequest,
	customerRequest,
	myRequests,
	portalGroups,
	requestTypeForm,
} from "./portal.ts";
import { listQueues, runQueue } from "./queues.ts";
import { issueSla } from "./sla.ts";

export interface CreatePortalRequestInput {
	requestTypeId: string;
	summary?: string;
	description?: string | null;
	fields: Record<string, string | string[] | null>;
	attachmentCount?: number;
}

export interface MyRequestFilters {
	status: "open" | "closed" | "all";
	scope: "created" | "participating" | "all";
	query: string;
}

export interface DeskSettingsInput {
	openAccess: boolean;
}

export interface QueuePageOptions {
	startAt: number;
	maxResults: number;
}

/** The portals a signed-in user may open, in project-key order. */
export async function listPortals(actor: CurrentUser) {
	const desks = await listDesks();
	const allowed = await Promise.all(
		desks.map((desk) => canRaiseRequests(actor, desk)),
	);
	return desks
		.filter((_, index) => allowed[index])
		.map((desk) => ({
			id: desk.id,
			name: desk.portalName,
			description: desk.description,
			projectKey: desk.projectKey,
			projectName: desk.projectName,
		}));
}

/** One portal with its request-type groups and the user's open request count. */
export async function portalDetail(actor: CurrentUser, portalId: string) {
	const desk = await deskByPortalId(portalId);
	if (!desk || !(await canRaiseRequests(actor, desk))) {
		throw new HttpError(404, "Portal not found");
	}

	const [groups, open] = await Promise.all([
		portalGroups(desk),
		myRequests(actor, {
			status: "open",
			scope: "all",
			query: "",
			deskId: desk.id,
		}),
	]);
	return {
		id: desk.id,
		name: desk.portalName,
		description: desk.description,
		announcement: desk.announcement,
		projectKey: desk.projectKey,
		projectName: desk.projectName,
		groups,
		openRequestCount: open.length,
	};
}

/** The form of one request type, when the user may open the portal. */
export async function portalRequestTypeForm(
	actor: CurrentUser,
	portalId: string,
	requestTypeId: string,
) {
	const desk = await deskByPortalId(portalId);
	if (!desk || !(await canRaiseRequests(actor, desk))) {
		throw new HttpError(404, "Portal not found");
	}
	const form = await requestTypeForm(desk, requestTypeId);
	if (!form) throw new HttpError(404, "Request type not found");
	return form;
}

/** Raise a request through the portal; the helper's 400/404 answers become HttpError. */
export async function createPortalRequest(
	actor: CurrentUser,
	portalId: string,
	input: CreatePortalRequestInput,
) {
	const desk = await deskByPortalId(portalId);
	if (!desk || !(await canRaiseRequests(actor, desk))) {
		throw new HttpError(404, "Portal not found");
	}

	const result = await createRequest(desk, input.requestTypeId, actor, {
		summary: input.summary ?? "",
		description: input.description ?? null,
		fields: input.fields,
		attachmentCount: input.attachmentCount,
	});
	if (!result.ok) throw new HttpError(result.status, result.error);
	return { id: result.id, key: result.key };
}

/** The signed-in user's requests, filtered as the portal asks. */
export async function listMyRequests(
	actor: CurrentUser,
	filters: MyRequestFilters,
) {
	const requests = await myRequests(actor, filters);
	return { requests, total: requests.length };
}

/** One request as its customer sees it. */
export async function portalRequest(
	actor: CurrentUser,
	portalId: string,
	key: string,
) {
	const desk = await deskByPortalId(portalId);
	if (!desk) throw new HttpError(404, "Portal not found");
	const view = await customerRequest(desk, key, actor);
	if (!view) throw new HttpError(404, "Request not found");
	return view;
}

/**
 * The data of the customer request page: the request exactly as the portal API shows it,
 * and the portal when the user may raise requests.
 */
export async function portalRequestView(
	actor: CurrentUser,
	portalId: string,
	key: string,
) {
	const desk = await deskByPortalId(portalId);
	if (!desk) throw new HttpError(404, "Portal not found");
	const [raises, request] = await Promise.all([
		canRaiseRequests(actor, desk),
		customerRequest(desk, key, actor),
	]);
	if (!request) throw new HttpError(404, "Request not found");
	return {
		portal: raises ? { id: desk.id, name: desk.portalName } : null,
		request,
	};
}

/** A public comment from the portal; internal notes stay internal. */
export async function addPortalComment(
	actor: CurrentUser,
	portalId: string,
	key: string,
	body: string,
) {
	const desk = await deskByPortalId(portalId);
	if (!desk) throw new HttpError(404, "Portal not found");
	const result = await addCustomerComment(desk, key, actor, body);
	if (!result.ok) throw new HttpError(result.status, result.error);
	return { id: result.id };
}

export async function deskSettings(actor: CurrentUser, projectKey: string) {
	const desk = await deskByProjectKey(projectKey);
	if (!desk) throw new HttpError(404, "Service desk not found");
	await requireProjectPermissionFor(
		actor,
		desk.projectId,
		"ADMINISTER_PROJECTS",
	);
	return { openAccess: desk.openAccess };
}

export async function updateDeskSettings(
	actor: CurrentUser,
	projectKey: string,
	input: DeskSettingsInput,
) {
	const desk = await deskByProjectKey(projectKey);
	if (!desk) throw new HttpError(404, "Service desk not found");
	await requireProjectPermissionFor(
		actor,
		desk.projectId,
		"ADMINISTER_PROJECTS",
	);

	const { openAccess } = input;
	if (openAccess !== desk.openAccess) {
		await db.transaction(async (tx) => {
			await tx
				.update(serviceDesks)
				.set({ openAccess, updatedAt: new Date() })
				.where(eq(serviceDesks.id, desk.id));
			await audit(tx, actor, {
				action: "servicedesk.update",
				entityType: "project",
				entityId: desk.projectId,
				summary: `Set open access of the service desk ${desk.projectKey} to ${openAccess ? "on" : "off"}`,
				changes: {
					from: { openAccess: desk.openAccess },
					to: { openAccess },
				},
			});
		});
	}
	return { openAccess };
}

export async function deskQueues(actor: CurrentUser, projectKey: string) {
	const desk = await deskByProjectKey(projectKey);
	if (!desk) throw new HttpError(404, "Queue not found");
	if (!(await isAgent(actor, desk))) {
		throw new HttpError(403, "Only agents can see queues");
	}
	return { isAgent: true, queues: await listQueues(desk, actor) };
}

export async function deskQueue(
	actor: CurrentUser,
	projectKey: string,
	queueId: string,
	options: QueuePageOptions,
) {
	const desk = await deskByProjectKey(projectKey);
	if (!desk) throw new HttpError(404, "Queue not found");
	if (!(await isAgent(actor, desk))) {
		throw new HttpError(403, "Only agents can see queues");
	}
	try {
		const page = await runQueue(desk, queueId, actor, options);
		if (!page) throw new HttpError(404, "Queue not found");
		return page;
	} catch (error) {
		if (error instanceof JqlError) {
			throw new HttpError(400, error.jiraMessage);
		}
		throw error;
	}
}

export async function deskIssueSla(actor: CurrentUser, key: string) {
	const [issue] = await db
		.select({ id: issues.id, projectId: issues.projectId })
		.from(issues)
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");
	const desk = await deskByProjectId(issue.projectId);
	if (!desk) throw new HttpError(404, "Issue not found");
	if (!(await isAgent(actor, desk))) {
		throw new HttpError(403, "Only agents can see SLAs");
	}
	await requireIssuePermissionFor(actor, key, "BROWSE_PROJECTS");
	return { metrics: await issueSla(issue.id) };
}

/** The customer-request panel shown on an issue the user may browse. */
export async function issueRequestPanel(actor: CurrentUser, key: string) {
	await requireIssuePermissionFor(actor, key, "BROWSE_PROJECTS");

	const [issue] = await db
		.select({
			requestTypeId: issues.requestTypeId,
			requestTypeName: requestTypes.name,
			channel: issues.requestChannel,
			projectId: issues.projectId,
		})
		.from(issues)
		.leftJoin(requestTypes, eq(requestTypes.id, issues.requestTypeId))
		.where(eq(issues.key, key.toUpperCase()))
		.limit(1);
	if (!issue) throw new HttpError(404, "Issue not found");
	const desk = await deskByProjectId(issue.projectId);
	const upper = key.toUpperCase();
	return {
		requestType:
			issue.requestTypeId && issue.requestTypeName
				? { id: issue.requestTypeId, name: issue.requestTypeName }
				: null,
		channel: issue.channel,
		portalId: desk?.id ?? null,
		customerUrl:
			desk && issue.requestTypeId
				? `/servicedesk/customer/portal/${desk.id}/${upper}`
				: null,
		isAgent: desk !== null && (await isAgent(actor, desk)),
	};
}
