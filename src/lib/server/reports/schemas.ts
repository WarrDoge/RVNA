import { z } from "zod";

export { boardParams } from "../agile/schemas.ts";

export const projectParams = z.object({ key: z.string().min(1).max(100) });
export const versionParams = z.object({
	key: z.string().min(1).max(100),
	versionId: z.uuid(),
});

export const estimationSchema = z
	.enum(["story_points", "original_estimate", "issue_count"])
	.optional();
export const reportQuery = z.object({
	sprintId: z.uuid().optional(),
	estimation: estimationSchema,
});
export const velocityQuery = z.object({ estimation: estimationSchema });
export const cfdQuery = z.object({
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
	assignee: z.string().optional(),
});
