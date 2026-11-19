/**
 * The Jira custom fields the importer maps and the server hides. Their ids
 * differ per Jira instance, so callers name a role and resolve it from a field
 * list instead of storing an id.
 */
export type CustomFieldRole =
	| "sprint"
	| "epicLink"
	| "epicName"
	| "epicStatus"
	| "epicColour"
	| "rank"
	| "developmentSummary"
	| "storyPoints";

const keyRoles: [CustomFieldRole, string][] = [
	["sprint", "com.pyxis.greenhopper.jira:gh-sprint"],
	["epicLink", "com.pyxis.greenhopper.jira:gh-epic-link"],
	["epicName", "com.pyxis.greenhopper.jira:gh-epic-label"],
	["epicStatus", "com.pyxis.greenhopper.jira:gh-epic-status"],
	["epicColour", "com.pyxis.greenhopper.jira:gh-epic-color"],
	["rank", "com.pyxis.greenhopper.jira:gh-lexo-rank"],
	[
		"developmentSummary",
		"com.atlassian.jira.plugins.jira-development-integration-plugin:devsummary",
	],
];

const storyPointsType =
	"com.atlassian.jira.plugin.system.customfieldtypes:float";
const storyPointsName = "story points";

export interface CustomFieldInfo {
	sourceId: string;
	name?: string | null;
	type?: string | null;
	customKey?: string | null;
}

export function customFieldRole(
	field: CustomFieldInfo,
): CustomFieldRole | null {
	for (const [role, key] of keyRoles) {
		if (field.customKey === key) return role;
	}
	if (
		field.customKey === storyPointsType &&
		field.name?.trim().toLowerCase() === storyPointsName
	) {
		return "storyPoints";
	}
	return null;
}

export type CustomFieldRoles = Partial<Record<CustomFieldRole, string>>;

export function resolveCustomFieldRoles(
	fields: readonly CustomFieldInfo[],
): CustomFieldRoles {
	const roles: CustomFieldRoles = {};
	for (const field of fields) {
		const role = customFieldRole(field);
		if (role && roles[role] === undefined) roles[role] = field.sourceId;
	}
	return roles;
}

export function customFieldId(
	roles: CustomFieldRoles | undefined,
	role: CustomFieldRole,
): string | null {
	return roles?.[role] ?? null;
}
