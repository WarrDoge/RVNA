import type { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import {
	type developmentSchema,
	getIssueDevelopment,
} from "../gitlab/routes.ts";
import { isHttpError } from "../http.ts";
import { requireBrowseIssue } from "../permissions.ts";
import type { requestPanelSchema, slaSchema } from "../servicedesk/schemas.ts";
import { deskIssueSla, issueRequestPanel } from "../servicedesk/service.ts";

/**
 * What the issue-view panels need on first paint: the GitLab development panel,
 * the service-desk request panel and, for agents, the SLA panel. Attachments,
 * links, sub-tasks and epic children travel with the issue itself.
 *
 * `development` is the API shape and may hold empty counts; the component hides
 * itself then. `sla` is null when the issue is not on a
 * service desk or the actor is not an agent, so the page never fails on the
 * panel's 403.
 *
 * The panels' own issue data (attachments, links, sub-tasks, epic children and
 * permissions) comes from `getIssue`; `loadIssueView` returns it as `issue` and
 * passes these three slices as the modules' `data` prop.
 */
export type IssuePanels = {
	development: z.infer<typeof developmentSchema>;
	request: z.infer<typeof requestPanelSchema>;
	sla: z.infer<typeof slaSchema> | null;
};

async function loadSla(
	actor: CurrentUser,
	key: string,
	context: Awaited<ReturnType<typeof requireBrowseIssue>>,
) {
	try {
		return await deskIssueSla(actor, key, context);
	} catch (cause) {
		if (isHttpError(cause) && (cause.status === 403 || cause.status === 404)) {
			return null;
		}
		throw cause;
	}
}

export async function loadIssuePanels(
	actor: CurrentUser,
	key: string,
	context?: Awaited<ReturnType<typeof requireBrowseIssue>>,
): Promise<IssuePanels> {
	const permission = context ?? (await requireBrowseIssue(actor, key));
	const [request, development] = await Promise.all([
		issueRequestPanel(actor, key, permission),
		getIssueDevelopment(actor, key, permission),
	]);
	const sla = request.isAgent ? await loadSla(actor, key, permission) : null;
	return { development, request, sla };
}
