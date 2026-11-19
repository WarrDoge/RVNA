import { eq } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "../auth.ts";
import { loadFieldsForContext, optionTree } from "../custom-fields.ts";
import { db } from "../db.ts";
import { HttpError } from "../http.ts";
import { requireProjectPermission } from "../projects/access.ts";
import { issueTypes, projects } from "../schema.ts";

export const projectParams = z.object({ key: z.string().min(1).max(100) });

export const projectCustomFieldsQuery = z.object({
	issueType: z.uuid().or(z.literal("")).optional(),
	includeDisabled: z.string().optional(),
});

export async function getProjectCustomFields(
	actor: CurrentUser,
	key: string,
	query: z.output<typeof projectCustomFieldsQuery>,
) {
	const [project] = await db
		.select({ id: projects.id })
		.from(projects)
		.where(eq(projects.key, key.toUpperCase()))
		.limit(1);
	if (!project) throw new HttpError(404, "Project not found");
	await requireProjectPermission(actor, project.id, "BROWSE_PROJECTS");

	const issueTypeId = query.issueType || null;
	if (issueTypeId) {
		const [type] = await db
			.select({ id: issueTypes.id })
			.from(issueTypes)
			.where(eq(issueTypes.id, issueTypeId))
			.limit(1);
		if (!type) throw new HttpError(404, "Issue type not found");
	}

	const includeDisabled =
		query.includeDisabled === "1" || query.includeDisabled === "true";
	const fieldsForContext = await loadFieldsForContext(project.id, issueTypeId);
	return fieldsForContext.map((field) => ({
		id: field.id,
		name: field.name,
		description: field.description,
		type: field.type,
		required: field.required,
		options: optionTree(field.options, includeDisabled),
	}));
}
