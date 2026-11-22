import { z } from "zod";
import {
	issueTypeRefSchema,
	priorityRefSchema,
	statusRefSchema,
	userRefSchema,
} from "../api-schemas.ts";

export const boardParams = z.object({
	rapidViewId: z.coerce.number().int().positive(),
});
export const sprintParams = z.object({ id: z.uuid() });

const boardProjectSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	name: z.string(),
});

export const boardRefSchema = z.object({
	id: z.uuid(),
	rapidViewId: z.number().int(),
	name: z.string(),
	type: z.enum(["scrum", "kanban"]),
	project: boardProjectSchema.nullable(),
	owner: userRefSchema.nullable(),
	configImported: z.boolean(),
});

export const sprintSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	goal: z.string().nullable(),
	state: z.enum(["future", "active", "closed"]),
	startDate: z.iso.datetime().nullable(),
	endDate: z.iso.datetime().nullable(),
	completeDate: z.iso.datetime().nullable(),
	sequence: z.number().int(),
});

const epicRefSchema = z.object({
	key: z.string(),
	summary: z.string(),
	colour: z.string().nullable(),
});

export const boardIssueSchema = z.object({
	id: z.uuid(),
	key: z.string(),
	summary: z.string(),
	type: issueTypeRefSchema,
	status: statusRefSchema,
	priority: priorityRefSchema.nullable(),
	assignee: userRefSchema.nullable(),
	epic: epicRefSchema.nullable(),
	estimate: z.number().nullable(),
	flagged: z.boolean(),
	rank: z.string().nullable(),
	sprintId: z.uuid().nullable(),
	columnId: z.uuid().nullable(),
});

export const boardColumnSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	sequence: z.number().int(),
	minIssues: z.number().int().nullable(),
	maxIssues: z.number().int().nullable(),
	statuses: z.array(statusRefSchema),
});

const swimlaneSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	jql: z.string(),
	sequence: z.number().int(),
});

const quickFilterSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	jql: z.string(),
	sequence: z.number().int(),
});

export const boardListEntrySchema = boardRefSchema.extend({
	canAdminister: z.boolean(),
});

export const boardConfigSchema = boardRefSchema.extend({
	filterJql: z.string(),
	estimationField: z.enum(["story_points", "original_estimate", "issue_count"]),
	swimlaneStrategy: z.enum(["none", "assignee", "epic", "queries"]),
	cardColourStrategy: z.enum([
		"none",
		"priority",
		"assignee",
		"epic",
		"issue_type",
	]),
	subFilterJql: z.string().nullable(),
	kanbanBacklogStatus: statusRefSchema.nullable(),
	columns: z.array(boardColumnSchema),
	swimlanes: z.array(swimlaneSchema),
	quickFilters: z.array(quickFilterSchema),
	availableStatuses: z.array(statusRefSchema),
});

const totalsSchema = z.object({
	new: z.number(),
	indeterminate: z.number(),
	done: z.number(),
});

export const boardDataSchema = z.object({
	board: boardConfigSchema,
	activeSprint: sprintSchema.nullable(),
	columns: z.array(boardColumnSchema),
	swimlanes: z.array(
		z.object({
			id: z.string(),
			name: z.string().nullable(),
			issues: z.array(boardIssueSchema),
		}),
	),
	quickFilters: z.array(quickFilterSchema),
	total: z.number().int(),
});

const backlogSprintSchema = sprintSchema.extend({
	issues: z.array(boardIssueSchema),
	totals: totalsSchema,
});

export const backlogDataSchema = z.object({
	board: boardConfigSchema,
	sprints: z.array(backlogSprintSchema),
	backlog: z.object({
		issues: z.array(boardIssueSchema),
		totals: totalsSchema,
	}),
	epics: z.array(
		epicRefSchema.extend({
			issueCount: z.number().int(),
			doneCount: z.number().int(),
		}),
	),
	versions: z.array(
		z.object({
			id: z.uuid(),
			name: z.string(),
			released: z.boolean(),
			issueCount: z.number().int(),
		}),
	),
	quickFilters: z.array(quickFilterSchema),
});

export const moveBody = z.object({
	issues: z.array(z.string().trim().min(1)).min(1).max(100),
	before: z.string().trim().min(1).optional(),
	after: z.string().trim().min(1).optional(),
	sprintId: z.uuid().nullable().optional(),
	columnId: z.uuid().optional(),
	statusId: z.uuid().optional(),
	epic: z.string().trim().min(1).nullable().optional(),
});

export const moveResponse = z.object({ moved: z.number().int() });

const sprintDatesInOrder = (body: {
	startDate?: string | null;
	endDate?: string | null;
}) =>
	body.startDate == null ||
	body.endDate == null ||
	new Date(body.endDate) > new Date(body.startDate);

export const sprintCreateBody = z
	.object({
		name: z.string().trim().min(1).max(200),
		goal: z.string().trim().max(2000).nullable().optional(),
		startDate: z.iso.datetime().nullable().optional(),
		endDate: z.iso.datetime().nullable().optional(),
	})
	.refine(sprintDatesInOrder, {
		message: "The end date must be after the start date",
		path: ["endDate"],
	});

export const sprintPatchBody = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		goal: z.string().trim().max(2000).nullable().optional(),
		startDate: z.iso.datetime().nullable().optional(),
		endDate: z.iso.datetime().nullable().optional(),
		sequence: z.number().int().optional(),
	})
	.refine(sprintDatesInOrder, {
		message: "The end date must be after the start date",
		path: ["endDate"],
	});

export const sprintStartBody = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	startDate: z.iso.datetime(),
	endDate: z.iso.datetime(),
	goal: z.string().trim().max(2000).nullable().optional(),
});

export const sprintCompleteBody = z.object({
	moveToSprintId: z.uuid().nullable().optional(),
});

export const sprintCompleteSchema = z.object({
	sprint: sprintSchema,
	completed: z.number().int(),
	incomplete: z.number().int(),
	movedToSprintId: z.uuid().nullable(),
});

export const sprintMoveBody = z.object({
	direction: z.enum(["up", "down"]),
});

export const columnsBody = z
	.object({
		columns: z
			.array(
				z.object({
					name: z.string().trim().min(1).max(200),
					minIssues: z.number().int().min(0).nullable().optional(),
					maxIssues: z.number().int().min(0).nullable().optional(),
					statuses: z.array(z.uuid()).max(500),
				}),
			)
			.min(1)
			.max(20),
	})
	.superRefine((body, context) => {
		body.columns.forEach((column, index) => {
			if (
				column.minIssues != null &&
				column.maxIssues != null &&
				column.minIssues > column.maxIssues
			) {
				context.addIssue({
					code: "custom",
					message: "The minimum cannot exceed the maximum",
					path: ["columns", index, "maxIssues"],
				});
			}
		});
	});

export const swimlanesBody = z.object({
	swimlanes: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(200),
				jql: z.string().trim().min(1).max(10_000),
			}),
		)
		.max(50),
});

export const quickFiltersBody = z.object({
	quickFilters: z
		.array(
			z.object({
				name: z.string().trim().min(1).max(200),
				jql: z.string().trim().min(1).max(10_000),
			}),
		)
		.max(50),
});

export const boardCreateBody = z.object({
	name: z.string().trim().min(1).max(200),
	type: z.enum(["scrum", "kanban"]),
	filterJql: z.string().trim().min(1).max(10_000),
	project: z.string().trim().min(1),
	estimationField: z
		.enum(["story_points", "original_estimate", "issue_count"])
		.optional(),
});

export const boardPatchBody = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	filterJql: z.string().trim().min(1).max(10_000).optional(),
	project: z.string().trim().min(1).optional(),
	estimationField: z
		.enum(["story_points", "original_estimate", "issue_count"])
		.optional(),
	swimlaneStrategy: z.enum(["none", "assignee", "epic", "queries"]).optional(),
	cardColourStrategy: z
		.enum(["none", "priority", "assignee", "epic", "issue_type"])
		.optional(),
	subFilterJql: z.string().trim().max(10_000).nullable().optional(),
	kanbanBacklogStatusId: z.uuid().nullable().optional(),
});

export const searchQuery = z.object({
	quickFilter: z.string().max(2000).optional(),
	text: z.string().max(500).optional(),
	epic: z.string().max(200).optional(),
	version: z.uuid().optional(),
	assignee: z.string().max(200).optional(),
});
