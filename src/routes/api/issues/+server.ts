import { errorSchema } from "#lib/server/api-schemas.ts";
import { endpoint } from "#lib/server/http.ts";
import {
	createIssueBody,
	issueDetailWithCustomFieldsSchema,
} from "#lib/server/issues/schemas.ts";
import { createIssueFromInput } from "#lib/server/issues/service.ts";

export const POST = endpoint(
	{
		body: createIssueBody,
		response: { 201: issueDetailWithCustomFieldsSchema, 400: errorSchema },
	},
	async ({ actor, body }) => {
		const issue = await createIssueFromInput(actor, {
			projectKey: body.project,
			typeId: body.type,
			summary: body.summary,
			description: body.description,
			priorityId: body.priority,
			assigneeId: body.assignee,
			reporterId: body.reporter,
			labels: body.labels,
			componentIds: body.components,
			fixVersionIds: body.fixVersions,
			parentKey: body.parent,
			epicKey: body.epic,
			customFields: body.customFields,
		});
		return { status: 201, body: issue };
	},
);
