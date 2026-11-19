import { z } from "zod";
import {
	commentSchema,
	historyEntrySchema,
	issueDetailSchema,
	issueLinkSchema,
	linkTypeSchema,
	userRefSchema,
	worklogSchema,
} from "../api-schemas.ts";
import { editableCustomFieldSchema } from "../custom-fields.ts";

export const issueParams = z.object({ key: z.string().min(1).max(100) });
export const commentParams = z.object({
	key: z.string().min(1),
	id: z.uuid(),
});
export const worklogParams = z.object({
	key: z.string().min(1),
	id: z.uuid(),
});
export const watcherParams = z.object({
	key: z.string().min(1),
	userId: z.uuid(),
});
export const linkParams = z.object({ id: z.uuid() });

export const issueDetailWithCustomFieldsSchema = issueDetailSchema.extend({
	editableCustomFields: z.array(editableCustomFieldSchema),
});

export const createIssueBody = z.object({
	project: z.string().trim().min(1),
	type: z.uuid(),
	summary: z.string().trim().min(1).max(255),
	description: z.string().nullable().optional(),
	priority: z.uuid().nullable().optional(),
	assignee: z.uuid().nullable().optional(),
	reporter: z.uuid().nullable().optional(),
	labels: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
	components: z.array(z.uuid()).optional(),
	fixVersions: z.array(z.uuid()).optional(),
	parent: z.string().trim().min(1).nullable().optional(),
	epic: z.string().trim().min(1).nullable().optional(),
	customFields: z.record(z.string(), z.unknown()).optional(),
});

export const cloneIssueBody = z
	.object({
		summary: z.string().trim().min(1).max(255).optional(),
	})
	.nullish();

export const updateIssueBody = z.object({
	summary: z.string().trim().min(1).max(255).optional(),
	description: z.string().nullable().optional(),
	priority: z.uuid().nullable().optional(),
	assignee: z.uuid().nullable().optional(),
	reporter: z.uuid().nullable().optional(),
	labels: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
	components: z.array(z.uuid()).optional(),
	fixVersions: z.array(z.uuid()).optional(),
	dueDate: z.iso.date().nullable().optional(),
	storyPoints: z.number().min(0).max(100_000).nullable().optional(),
	originalEstimate: z.number().int().min(0).nullable().optional(),
	remainingEstimate: z.number().int().min(0).nullable().optional(),
	epic: z.string().trim().min(1).nullable().optional(),
	customFields: z.record(z.string(), z.unknown()).optional(),
});

export const transitionBody = z.object({
	transitionId: z.uuid(),
	resolutionId: z.uuid().optional(),
});

export const commentBody = z.object({
	body: z.string().min(1).max(200_000),
	internal: z.boolean().optional(),
});

export const commentUpdateBody = z.object({
	body: z.string().min(1).max(200_000),
});

export const worklogBody = z.object({
	seconds: z.number().int().positive().max(31_536_000),
	started: z.iso.datetime().optional(),
	comment: z.string().trim().max(10_000).optional(),
	remainingEstimate: z.number().int().min(0).nullable().optional(),
});

export const watcherBody = z.object({ userId: z.uuid() });

export const linkBody = z.object({
	typeId: z.uuid(),
	targetKey: z.string().trim().min(1),
	direction: z.enum(["outward", "inward"]),
});

export const watchResponse = z.object({
	count: z.number().int(),
	watching: z.boolean(),
});
export const watchersResponse = z.object({
	watchers: z.array(userRefSchema),
});
export const resolutionsResponse = z.array(
	z.object({ id: z.uuid(), name: z.string() }),
);
export const linkTypesResponse = z.array(linkTypeSchema);
export const commentsResponse = z.array(commentSchema);
export const historyResponse = z.array(historyEntrySchema);
export const worklogsResponse = z.array(worklogSchema);
export const commentResponse = commentSchema;
export const worklogResponse = worklogSchema;
export const linkResponse = issueLinkSchema;
