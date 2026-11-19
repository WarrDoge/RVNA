import { z } from "zod";

export const errorSchema = z.object({
	error: z.string(),
	/** The detail of a validation failure; existing clients may ignore it. */
	message: z.string().optional(),
});

export const statusCategorySchema = z.enum(["new", "indeterminate", "done"]);

export const userRefSchema = z.object({
	id: z.uuid(),
	username: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().nullable(),
});

export const userWithEmailSchema = userRefSchema.extend({
	email: z.string().nullable().optional(),
});

export const issueTypeRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	subtask: z.boolean(),
	iconUrl: z.string().nullable().optional(),
});

export const statusRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	category: statusCategorySchema,
});

export const priorityRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	iconColor: z.string().nullable(),
	iconUrl: z.string().nullable().optional(),
});

export const resolutionRefSchema = z.object({
	id: z.uuid(),
	name: z.string(),
});

export const projectTypeSchema = z.enum(["software", "service_desk"]);

export const projectRefSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
	avatarUrl: z.string().nullable(),
	type: projectTypeSchema,
});

export const issueRefSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	summary: z.string(),
	type: issueTypeRefSchema,
	status: statusRefSchema,
	priority: priorityRefSchema.nullable(),
	assignee: userRefSchema.nullable(),
});

export const projectSummarySchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	type: projectTypeSchema,
	lead: userRefSchema.nullable(),
	category: z.string().nullable(),
	avatarUrl: z.string().nullable(),
	issueCount: z.number().int(),
	archived: z.boolean(),
	permissions: z.record(z.string(), z.boolean()),
});

export const componentSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	lead: userRefSchema.nullable(),
});

export const versionSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	released: z.boolean(),
	archived: z.boolean(),
	startDate: z.string().nullable(),
	releaseDate: z.string().nullable(),
});

export const workflowSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	statuses: z.array(statusRefSchema),
});

export const projectDetailSchema = projectSummarySchema.extend({
	issueTypes: z.array(
		issueTypeRefSchema.extend({
			iconUrl: z.string().nullable(),
			workflow: workflowSchema.nullable(),
		}),
	),
	components: z.array(componentSchema),
	versions: z.array(versionSchema),
	priorities: z.array(priorityRefSchema),
});

export const projectIssueSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	summary: z.string(),
	type: issueTypeRefSchema,
	status: statusRefSchema,
	priority: priorityRefSchema.nullable(),
	resolution: resolutionRefSchema.nullable(),
	assignee: userRefSchema.nullable(),
	reporter: userRefSchema.nullable(),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
});

export const projectIssueListSchema = z.object({
	issues: z.array(projectIssueSchema),
	total: z.number().int(),
	offset: z.number().int(),
	limit: z.number().int(),
});

export const attachmentSchema = z.object({
	id: z.uuid(),
	fileName: z.string(),
	mimeType: z.string().nullable(),
	size: z.number().int(),
	author: userRefSchema.nullable(),
	created: z.iso.datetime().nullable(),
});

export const linkTypeSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	inward: z.string(),
	outward: z.string(),
});

export const issueLinkGroupSchema = z.object({
	type: linkTypeSchema,
	direction: z.enum(["inward", "outward"]),
	links: z.array(z.object({ id: z.uuid(), issue: issueRefSchema })),
});

export const transitionSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	asksResolution: z.boolean(),
	to: statusRefSchema,
});

export const customFieldSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	value: z.string(),
});

export const issueDetailSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	number: z.number().int(),
	summary: z.string(),
	descriptionHtml: z.string().nullable(),
	project: projectRefSchema,
	type: issueTypeRefSchema,
	status: statusRefSchema,
	priority: priorityRefSchema.nullable(),
	resolution: resolutionRefSchema.nullable(),
	reporter: userRefSchema.nullable(),
	assignee: userRefSchema.nullable(),
	creator: userRefSchema.nullable(),
	parent: issueRefSchema.nullable(),
	subtasks: z.array(issueRefSchema),
	epic: issueRefSchema.nullable(),
	epicIssues: z.array(issueRefSchema),
	labels: z.array(z.string()),
	components: z.array(z.object({ id: z.uuid(), name: z.string() })),
	fixVersions: z.array(z.object({ id: z.uuid(), name: z.string() })),
	affectsVersions: z.array(z.object({ id: z.uuid(), name: z.string() })),
	links: z.array(issueLinkGroupSchema),
	attachments: z.array(attachmentSchema),
	watchers: z.object({ count: z.number().int(), watching: z.boolean() }),
	timeTracking: z.object({
		originalEstimate: z.number().int().nullable(),
		remainingEstimate: z.number().int().nullable(),
		timeSpent: z.number().int().nullable(),
	}),
	storyPoints: z.number().nullable(),
	dueDate: z.string().nullable(),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
	resolved: z.iso.datetime().nullable(),
	customFields: z.array(customFieldSchema),
	transitions: z.array(transitionSchema),
	permissions: z.record(z.string(), z.boolean()),
});

export const commentSchema = z.object({
	id: z.uuid(),
	author: userRefSchema.nullable(),
	bodyHtml: z.string().nullable(),
	created: z.iso.datetime().nullable(),
	updated: z.iso.datetime().nullable(),
	internal: z.boolean(),
});

export const historyItemSchema = z.object({
	field: z.string(),
	fieldType: z.string().nullable(),
	from: z.string().nullable(),
	fromText: z.string().nullable(),
	to: z.string().nullable(),
	toText: z.string().nullable(),
});

export const historyEntrySchema = z.object({
	id: z.uuid(),
	author: userRefSchema.nullable(),
	created: z.iso.datetime().nullable(),
	via: z.string().nullable(),
	items: z.array(historyItemSchema),
});

export const worklogSchema = z.object({
	id: z.uuid(),
	author: userRefSchema.nullable(),
	started: z.iso.datetime().nullable(),
	seconds: z.number().int(),
	comment: z.string().nullable(),
});

export const issueLinkSchema = z.object({
	id: z.uuid(),
	type: linkTypeSchema,
	direction: z.enum(["inward", "outward"]),
	issue: issueRefSchema,
});
