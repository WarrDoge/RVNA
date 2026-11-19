/** URL segment and entity name used by the five issue configuration screens. */
export type ConfigEntity =
	| "issue-types"
	| "priorities"
	| "resolutions"
	| "statuses"
	| "link-types";

export type WorkflowRef = { id: string; name: string };

/** Everything still pointing at a configuration row. */
export type EntityReferences = {
	count: number;
	canMigrate: boolean;
	workflows?: WorkflowRef[];
	projectCount?: number;
};

export type ConfigColumn = { label: string; width?: number };

export type ConfigCandidate = { id: string; name: string };

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}
