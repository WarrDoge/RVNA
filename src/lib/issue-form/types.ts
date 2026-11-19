import type { IssueDetail, UserRef } from "#lib/api-types.ts";
import { formatDuration } from "#lib/dates.ts";

export type CreateDefaults = {
	projectKey?: string;
	typeId?: string;
	parent?: string;
	epic?: string;
};

export type IssueFormValues = {
	projectKey: string;
	typeId: string;
	summary: string;
	description: string;
	priorityId: string;
	assignee: UserRef | null;
	reporter: UserRef | null;
	labels: string;
	componentIds: string[];
	fixVersionIds: string[];
	epicKey: string;
	parentKey: string;
	dueDate: string;
	storyPoints: string;
	originalEstimate: string;
	remainingEstimate: string;
	/** Configurable custom field values, keyed by field id. */
	customFields: Record<string, unknown>;
};

export function emptyValues(projectKey = ""): IssueFormValues {
	return {
		projectKey,
		typeId: "",
		summary: "",
		description: "",
		priorityId: "",
		assignee: null,
		reporter: null,
		labels: "",
		componentIds: [],
		fixVersionIds: [],
		epicKey: "",
		parentKey: "",
		dueDate: "",
		storyPoints: "",
		originalEstimate: "",
		remainingEstimate: "",
		customFields: {},
	};
}

export function fromIssue(issue: IssueDetail): IssueFormValues {
	return {
		projectKey: issue.project.key,
		typeId: issue.type.id,
		summary: issue.summary,
		description: issue.descriptionHtml ?? "",
		priorityId: issue.priority?.id ?? "",
		assignee: issue.assignee,
		reporter: issue.reporter,
		labels: issue.labels.join(" "),
		componentIds: issue.components.map((component) => component.id),
		fixVersionIds: issue.fixVersions.map((version) => version.id),
		epicKey: issue.epic?.key ?? "",
		parentKey: issue.parent?.key ?? "",
		dueDate: issue.dueDate ?? "",
		storyPoints: issue.storyPoints === null ? "" : String(issue.storyPoints),
		originalEstimate:
			issue.timeTracking.originalEstimate === null
				? ""
				: formatDuration(issue.timeTracking.originalEstimate),
		remainingEstimate:
			issue.timeTracking.remainingEstimate === null
				? ""
				: formatDuration(issue.timeTracking.remainingEstimate),
		customFields: Object.fromEntries(
			(issue.editableCustomFields ?? []).map((field) => [
				field.id,
				field.value,
			]),
		),
	};
}

export function parseLabels(value: string) {
	return [
		...new Set(
			value
				.split(/[,\s]+/)
				.map((label) => label.trim())
				.filter((label) => label !== ""),
		),
	];
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}
