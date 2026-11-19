import type { StatusCategory } from "../api-types.ts";

export type { StatusCategory };

export type StatusOption = {
	id: string;
	name: string;
	category: StatusCategory;
};

export type WorkflowProject = {
	id: string;
	key: string;
	name: string;
	issueTypes: "all" | { id: string; name: string }[];
};

export type WorkflowSummary = {
	id: string;
	name: string;
	description: string | null;
	statusCount: number;
	transitionCount: number;
	hasDraft: boolean;
	updatedAt: string;
	projects: WorkflowProject[];
};

export type WorkflowStatus = StatusOption & { issueCount: number };

export type WorkflowTransition = {
	id: string;
	name: string;
	fromStatusId: string | null;
	toStatusId: string;
	asksResolution: boolean;
};

export type WorkflowDetail = {
	id: string;
	name: string;
	description: string | null;
	hasDraft: boolean;
	mode: "draft" | "live";
	initialStatusId: string | null;
	statuses: WorkflowStatus[];
	transitions: WorkflowTransition[];
	projects: WorkflowProject[];
};

export type Definition = {
	initialStatusId: string | null;
	statuses: string[];
	transitions: WorkflowTransition[];
};

export type Problem = {
	code:
		| "no_initial_status"
		| "unreachable_status"
		| "duplicate_transition"
		| "removed_status_in_use"
		| "invalid_mapping"
		| "unknown_status";
	message: string;
	statusId?: string;
	statusName?: string;
	issueCount?: number;
};

export type PublishResult = {
	ok: boolean;
	problems: Problem[];
	movedIssues: number;
};

export type Needed = {
	issueTypeId: string;
	issueTypeName: string;
	statusId: string;
	statusName: string;
	issueCount: number;
	candidates: StatusOption[];
};

export type Assignment = {
	project: { id: string; key: string; name: string };
	issueTypes: { id: string; name: string }[];
	defaultWorkflowId: string | null;
	perType: { issueTypeId: string; workflowId: string }[];
	workflows: { id: string; name: string }[];
};

export type AssignmentResult = {
	ok: boolean;
	needed: Needed[];
	moved: number;
};
