import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { CurrentUser } from "./auth.ts";
import { db } from "./db.ts";
import { env } from "./env.ts";
import { issueTypes, priorities } from "./schema.ts";
import { appSettings } from "./schema-admin.ts";

export const siteTitleKey = "site.title";
export const defaultIssueTypeKey = "site.defaultIssueTypeId";
export const defaultPriorityKey = "site.defaultPriorityId";

export const settingKeys = [
	siteTitleKey,
	defaultIssueTypeKey,
	defaultPriorityKey,
] as const;

export const fallbackSiteTitle = "RVNA";

export const siteSettingsSchema = z.object({
	title: z.string(),
	baseUrl: z.string(),
	defaultIssueTypeId: z.uuid().nullable(),
	defaultPriorityId: z.uuid().nullable(),
});

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

function uuidOrNull(value: unknown) {
	const parsed = z.uuid().safeParse(value);
	return parsed.success ? parsed.data : null;
}

export async function readSettingValues() {
	const rows = await db
		.select({ key: appSettings.key, value: appSettings.value })
		.from(appSettings)
		.where(inArray(appSettings.key, [...settingKeys]));
	return new Map(rows.map((row) => [row.key, row.value]));
}

/** Settings as every signed-in user sees them: blank titles and dangling ids fall back. */
export async function readSiteSettings(): Promise<SiteSettings> {
	const values = await readSettingValues();

	const storedTitle = values.get(siteTitleKey);
	const title =
		typeof storedTitle === "string" && storedTitle.trim() !== ""
			? storedTitle.trim()
			: fallbackSiteTitle;

	const issueTypeId = uuidOrNull(values.get(defaultIssueTypeKey));
	const priorityId = uuidOrNull(values.get(defaultPriorityKey));

	const [issueTypeRows, priorityRows] = await Promise.all([
		issueTypeId
			? db
					.select({ id: issueTypes.id })
					.from(issueTypes)
					.where(
						and(eq(issueTypes.id, issueTypeId), eq(issueTypes.subtask, false)),
					)
			: [],
		priorityId
			? db
					.select({ id: priorities.id })
					.from(priorities)
					.where(eq(priorities.id, priorityId))
			: [],
	]);

	return {
		title,
		baseUrl: env.APP_URL,
		defaultIssueTypeId: issueTypeRows.length > 0 ? issueTypeId : null,
		defaultPriorityId: priorityRows.length > 0 ? priorityId : null,
	};
}

export async function siteSettings(_actor: CurrentUser): Promise<SiteSettings> {
	return readSiteSettings();
}
