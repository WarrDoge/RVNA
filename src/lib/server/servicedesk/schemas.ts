import { z } from "zod";

export const portalParams = z.object({ id: z.uuid() });
export const requestParams = z.object({
	id: z.uuid(),
	key: z.string().min(1).max(100),
});
export const formParams = z.object({
	id: z.uuid(),
	requestTypeId: z.uuid(),
});
export const projectParams = z.object({ key: z.string().min(1).max(100) });
export const queueParams = z.object({
	key: z.string().min(1).max(100),
	queueId: z.uuid(),
});
export const issueParams = z.object({ key: z.string().min(1).max(100) });

export const deskSettingsSchema = z.object({ openAccess: z.boolean() });

export const portalSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	projectKey: z.string(),
	projectName: z.string(),
});

export const portalListSchema = z.array(portalSchema);

export const requestTypeSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	description: z.string().nullable(),
	helpText: z.string().nullable(),
	iconName: z.string().nullable(),
});

export const groupSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	requestTypes: z.array(requestTypeSchema),
});

export const portalDetailSchema = portalSchema.extend({
	announcement: z.string().nullable(),
	groups: z.array(groupSchema),
	openRequestCount: z.number().int(),
});

export const formFieldSchema = z.object({
	fieldId: z.string(),
	label: z.string(),
	description: z.string().nullable(),
	required: z.boolean(),
	sequence: z.number().int(),
	hidden: z.boolean(),
	kind: z.enum([
		"text",
		"rich",
		"date",
		"datetime",
		"option",
		"components",
		"priority",
		"attachment",
		"array",
	]),
	options: z.array(z.object({ id: z.string(), label: z.string() })),
});

export const formSchema = z.object({
	requestType: requestTypeSchema.extend({
		portalId: z.uuid(),
		projectKey: z.string(),
	}),
	fields: z.array(formFieldSchema),
});

export const createRequestSchema = z.object({
	requestTypeId: z.uuid(),
	summary: z.string().trim().max(255).optional(),
	description: z.string().max(200_000).nullable().optional(),
	fields: z
		.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()]))
		.default({}),
});

export const createdRequestSchema = z.object({ id: z.uuid(), key: z.string() });

export const myRequestSchema = z.object({
	key: z.string(),
	summary: z.string(),
	status: z.object({ name: z.string(), category: z.string() }),
	reporter: z.object({ displayName: z.string() }).nullable(),
	requestType: z.string().nullable(),
	portalId: z.uuid(),
	created: z.iso.datetime().nullable(),
});

export const myRequestsSchema = z.object({
	requests: z.array(myRequestSchema),
	total: z.number().int(),
});

export const myRequestsQuerySchema = z.object({
	status: z.enum(["open", "closed", "all"]).default("open"),
	scope: z.enum(["created", "participating", "all"]).default("all"),
	q: z.string().trim().max(200).default(""),
});

export const customerRequestSchema = z.object({
	key: z.string(),
	summary: z.string(),
	descriptionHtml: z.string().nullable(),
	status: z.object({ name: z.string(), category: z.string() }),
	requestType: z.object({ id: z.uuid(), name: z.string() }).nullable(),
	created: z.iso.datetime().nullable(),
	reporter: z.object({ displayName: z.string() }).nullable(),
	attachments: z.array(
		z.object({
			id: z.uuid(),
			fileName: z.string(),
			size: z.number().int(),
		}),
	),
	comments: z.array(
		z.object({
			id: z.uuid(),
			author: z.string().nullable(),
			bodyHtml: z.string().nullable(),
			created: z.iso.datetime().nullable(),
		}),
	),
});

export const commentBodySchema = z.object({
	body: z.string().min(1).max(200_000),
});

export const commentCreatedSchema = z.object({ id: z.uuid() });

const queueSummarySchema = z.object({
	id: z.uuid(),
	name: z.string(),
	jql: z.string(),
});

export const queueListSchema = z.object({
	isAgent: z.boolean(),
	queues: z.array(
		queueSummarySchema.extend({
			parentId: z.uuid().nullable(),
			sequence: z.number().int(),
			issueCount: z.number().int().nullable(),
			liveCount: z.number().int().nullable(),
		}),
	),
});

const cellKindSchema = z.enum([
	"key",
	"summary",
	"type",
	"status",
	"priority",
	"user",
	"text",
	"date",
	"components",
	"sla",
]);

const slaStateSchema = z.enum(["ongoing", "paused", "completed", "breached"]);

export const cellSchema = z.object({
	kind: cellKindSchema,
	text: z.string().nullable(),
	href: z.string().nullable(),
	category: z.string().nullable(),
	iconColor: z.string().nullable(),
	state: slaStateSchema.nullable(),
	remainingMinutes: z.number().int().nullable(),
	breached: z.boolean().nullable(),
	names: z.array(z.string()),
});

export const queueQuerySchema = z.object({
	startAt: z.coerce.number().int().min(0).default(0),
	maxResults: z.coerce.number().int().min(1).max(100).default(50),
});

export const queuePageSchema = z.object({
	queue: queueSummarySchema,
	columns: z.array(
		z.object({
			id: z.string(),
			label: z.string(),
			kind: cellKindSchema,
		}),
	),
	startAt: z.number().int(),
	maxResults: z.number().int(),
	total: z.number().int(),
	issues: z.array(
		z.object({
			key: z.string(),
			summary: z.string(),
			cells: z.record(z.string(), cellSchema),
		}),
	),
});

export const slaSchema = z.object({
	metrics: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			customerVisible: z.boolean(),
			goalMinutes: z.number().int().nullable(),
			calendar: z.object({ name: z.string(), timezone: z.string() }).nullable(),
			cycles: z.array(
				z.object({
					cycle: z.number().int(),
					state: slaStateSchema,
					startedAt: z.iso.datetime(),
					stoppedAt: z.iso.datetime().nullable(),
					goalMinutes: z.number().int().nullable(),
					elapsedMinutes: z.number().int(),
					remainingMinutes: z.number().int().nullable(),
					breached: z.boolean(),
					breachTime: z.iso.datetime().nullable(),
				}),
			),
		}),
	),
});

export const requestPanelSchema = z.object({
	requestType: z.object({ id: z.uuid(), name: z.string() }).nullable(),
	channel: z.string().nullable(),
	portalId: z.uuid().nullable(),
	customerUrl: z.string().nullable(),
	isAgent: z.boolean(),
});
