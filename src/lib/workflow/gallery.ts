import type {
	WorkflowDetail,
	WorkflowStatus,
	WorkflowTransition,
} from "./types.ts";

const status = (
	id: string,
	name: string,
	category: WorkflowStatus["category"],
): WorkflowStatus => ({ id, name, category, issueCount: 0 });

const transition = (
	id: string,
	name: string,
	fromStatusId: string | null,
	toStatusId: string,
): WorkflowTransition => ({
	id,
	name,
	fromStatusId,
	toStatusId,
	asksResolution: false,
});

const supportFlow = {
	id: "gallery-support-flow",
	name: "Support flow",
	description: "A short flow with a global entry and two loops.",
	hasDraft: false,
	mode: "live",
	initialStatusId: "gallery-support-todo",
	statuses: [
		status("gallery-support-todo", "To Do", "new"),
		status("gallery-support-progress", "In Progress", "indeterminate"),
		status("gallery-support-done", "Done", "done"),
	],
	transitions: [
		transition(
			"gallery-support-start",
			"Start work",
			"gallery-support-todo",
			"gallery-support-progress",
		),
		transition(
			"gallery-support-finish",
			"Finish",
			"gallery-support-progress",
			"gallery-support-done",
		),
		transition(
			"gallery-support-reopen",
			"Reopen",
			"gallery-support-done",
			"gallery-support-todo",
		),
		transition(
			"gallery-support-restart",
			"Restart",
			"gallery-support-done",
			"gallery-support-progress",
		),
		transition(
			"gallery-support-escalate",
			"Escalate from any status",
			null,
			"gallery-support-progress",
		),
	],
	projects: [],
} satisfies WorkflowDetail;

const releasePipeline = {
	id: "gallery-release-pipeline",
	name: "Release pipeline",
	description: "A ten-status pipeline with a global block and several loops.",
	hasDraft: false,
	mode: "live",
	initialStatusId: "gallery-release-backlog",
	statuses: [
		status("gallery-release-backlog", "Backlog", "new"),
		status("gallery-release-ready", "Ready", "new"),
		status("gallery-release-design", "In Design", "indeterminate"),
		status("gallery-release-build", "In Build", "indeterminate"),
		status("gallery-release-review", "In Review", "indeterminate"),
		status("gallery-release-qa", "QA", "indeterminate"),
		status("gallery-release-staging", "Staging", "indeterminate"),
		status("gallery-release-blocked", "Blocked", "indeterminate"),
		status("gallery-release-released", "Released", "done"),
		status("gallery-release-cancelled", "Cancelled", "done"),
	],
	transitions: [
		transition(
			"gallery-release-groom",
			"Groom",
			"gallery-release-backlog",
			"gallery-release-ready",
		),
		transition(
			"gallery-release-design",
			"Design",
			"gallery-release-ready",
			"gallery-release-design",
		),
		transition(
			"gallery-release-build",
			"Build",
			"gallery-release-design",
			"gallery-release-build",
		),
		transition(
			"gallery-release-review",
			"Review",
			"gallery-release-build",
			"gallery-release-review",
		),
		transition(
			"gallery-release-verify",
			"Verify",
			"gallery-release-review",
			"gallery-release-qa",
		),
		transition(
			"gallery-release-stage",
			"Stage",
			"gallery-release-qa",
			"gallery-release-staging",
		),
		transition(
			"gallery-release-release",
			"Release",
			"gallery-release-staging",
			"gallery-release-released",
		),
		transition(
			"gallery-release-cancel",
			"Cancel",
			"gallery-release-backlog",
			"gallery-release-cancelled",
		),
		transition(
			"gallery-release-block",
			"Block from any status",
			null,
			"gallery-release-blocked",
		),
		transition(
			"gallery-release-rework",
			"Rework",
			"gallery-release-qa",
			"gallery-release-build",
		),
		transition(
			"gallery-release-regression",
			"Regression",
			"gallery-release-staging",
			"gallery-release-qa",
		),
		transition(
			"gallery-release-hotfix",
			"Hotfix",
			"gallery-release-staging",
			"gallery-release-review",
		),
		transition(
			"gallery-release-reopen",
			"Reopen",
			"gallery-release-released",
			"gallery-release-backlog",
		),
		transition(
			"gallery-release-restore",
			"Restore",
			"gallery-release-cancelled",
			"gallery-release-backlog",
		),
		transition(
			"gallery-release-fast-track",
			"Fast track",
			"gallery-release-design",
			"gallery-release-qa",
		),
	],
	projects: [],
} satisfies WorkflowDetail;

export const workflowGallery = {
	supportFlow,
	releasePipeline,
};
