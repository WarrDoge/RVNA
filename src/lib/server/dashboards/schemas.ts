import { z } from "zod";
import {
	DASHBOARD_LAYOUTS,
	type DashboardLayout,
	GADGET_TYPES,
	type GadgetType,
} from "../../shared/gadgets.ts";
import { userRefSchema } from "../api-schemas.ts";

const gadgetTypeSchema = z.enum(
	GADGET_TYPES.map((gadget) => gadget.type) as [GadgetType, ...GadgetType[]],
);

const layoutSchema = z.enum(
	DASHBOARD_LAYOUTS.map((layout) => layout.value) as [
		DashboardLayout,
		...DashboardLayout[],
	],
);

const MAX_LAYOUT_COLUMNS = Math.max(
	...DASHBOARD_LAYOUTS.map((layout) => layout.columns),
);

/** Deeper offsets only make Postgres scan rows the gadget will never show. */
const MAX_GADGET_START_AT = 10_000;

export const gadgetSchema = z.object({
	id: z.uuid(),
	sourceId: z.string().nullable(),
	type: z.string(),
	title: z.string().nullable(),
	column: z.number().int(),
	row: z.number().int(),
	color: z.string(),
	refreshSeconds: z.number().int(),
	config: z.record(z.string(), z.unknown()),
});

export const dashboardSummarySchema = z.object({
	id: z.uuid(),
	sourceId: z.string().nullable(),
	name: z.string(),
	description: z.string().nullable(),
	layout: layoutSchema,
	shared: z.boolean(),
	owner: userRefSchema,
	favourite: z.boolean(),
	favouriteCount: z.number().int(),
	gadgetCount: z.number().int(),
	canEdit: z.boolean(),
	createdAt: z.iso.datetime(),
	updatedAt: z.iso.datetime(),
});

export const dashboardDetailSchema = dashboardSummarySchema.extend({
	gadgets: z.array(gadgetSchema),
});

export const favouriteSchema = z.object({
	favourite: z.boolean(),
	favouriteCount: z.number().int(),
});

export const dashboardParams = z.object({ id: z.string().min(1) });
export const gadgetParams = z.object({ id: z.uuid() });

export const listQuery = z.object({
	scope: z
		.enum(["visible", "mine", "favourite", "popular", "search"])
		.default("visible"),
	query: z.string().trim().max(200).default(""),
});

export const createBody = z.object({
	name: z.string().trim().min(1).max(255),
	description: z.string().trim().max(2000).nullable().optional(),
	layout: layoutSchema.optional(),
	shared: z.boolean().optional(),
	copyOf: z.string().min(1).optional(),
});

export const patchBody = z.object({
	name: z.string().trim().min(1).max(255).optional(),
	description: z.string().trim().max(2000).nullable().optional(),
	layout: layoutSchema.optional(),
	shared: z.boolean().optional(),
});

export const gadgetBody = z.object({
	type: gadgetTypeSchema,
	title: z.string().trim().max(255).nullable().optional(),
	color: z.string().max(32).optional(),
	refreshSeconds: z.number().int().min(0).max(86_400).optional(),
	config: z.record(z.string(), z.unknown()).optional(),
	column: z
		.number()
		.int()
		.min(0)
		.max(MAX_LAYOUT_COLUMNS - 1)
		.optional(),
	row: z.number().int().min(0).max(10_000).optional(),
});

export const gadgetPatchBody = z.object({
	title: z.string().trim().max(255).nullable().optional(),
	color: z.string().max(32).optional(),
	refreshSeconds: z.number().int().min(0).max(86_400).optional(),
	config: z.record(z.string(), z.unknown()).optional(),
});

export const layoutBody = z.object({
	columns: z.array(z.array(z.uuid()).max(200)).max(MAX_LAYOUT_COLUMNS),
});

export const gadgetDataQuery = z.object({
	startAt: z.coerce.number().int().min(0).max(MAX_GADGET_START_AT).default(0),
});

export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type DashboardDetail = z.infer<typeof dashboardDetailSchema>;
export type GadgetRow = z.infer<typeof gadgetSchema>;
export type ListQuery = z.infer<typeof listQuery>;
export type CreateDashboardBody = z.infer<typeof createBody>;
export type PatchDashboardBody = z.infer<typeof patchBody>;
export type GadgetBody = z.infer<typeof gadgetBody>;
export type GadgetPatchBody = z.infer<typeof gadgetPatchBody>;
export type LayoutBody = z.infer<typeof layoutBody>;
export type FavouriteResult = z.infer<typeof favouriteSchema>;
