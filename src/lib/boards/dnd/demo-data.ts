import type {
	BoardIssue,
	EstimateTotals,
	IssueTypeRef,
	PriorityRef,
	StatusRef,
	UserRef,
} from "#lib/api-types.ts";

export type DemoColumn = {
	id: string;
	name: string;
	statuses: StatusRef[];
};

export type DemoLane = {
	id: string;
	name: string;
	cards: BoardIssue[];
};

export type DemoSprint = {
	id: string;
	name: string;
	state: "active" | "future";
	issues: BoardIssue[];
};

const users = {
	ada: {
		id: "user-ada",
		username: "ada",
		displayName: "Avery Stone",
		avatarUrl: null,
	},
	grace: {
		id: "user-grace",
		username: "grace",
		displayName: "Blake Reed",
		avatarUrl: null,
	},
	linus: {
		id: "user-linus",
		username: "linus",
		displayName: "Casey Lane",
		avatarUrl: null,
	},
} satisfies Record<string, UserRef>;

const types = {
	task: {
		id: "type-task",
		name: "Task",
		subtask: false,
		iconUrl: "builtin:task",
	},
	bug: { id: "type-bug", name: "Bug", subtask: false, iconUrl: "builtin:bug" },
	story: {
		id: "type-story",
		name: "Story",
		subtask: false,
		iconUrl: "builtin:story",
	},
} satisfies Record<string, IssueTypeRef>;

const priorities = {
	high: { id: "priority-high", name: "High", iconColor: "#e5493a" },
	medium: { id: "priority-medium", name: "Medium", iconColor: "#f6c243" },
	low: { id: "priority-low", name: "Low", iconColor: "#4bade8" },
} satisfies Record<string, PriorityRef>;

const epics = {
	faster: {
		key: "DND-EPIC-1",
		summary: "Faster boards",
		colour: "ghx-label-2",
	},
	keyboard: {
		key: "DND-EPIC-2",
		summary: "Keyboard path",
		colour: "ghx-label-3",
	},
	hygiene: {
		key: "DND-EPIC-3",
		summary: "Board hygiene",
		colour: "ghx-label-8",
	},
} satisfies Record<string, NonNullable<BoardIssue["epic"]>>;

type IssueOptions = {
	type: IssueTypeRef;
	status: StatusRef;
	priority?: PriorityRef | null;
	assignee?: UserRef | null;
	epic?: NonNullable<BoardIssue["epic"]> | null;
	estimate?: number | null;
	flagged?: boolean;
	columnId?: string | null;
	sprintId?: string | null;
};

function issue(
	key: string,
	summary: string,
	options: IssueOptions,
): BoardIssue {
	return {
		id: key.toLowerCase(),
		key,
		summary,
		type: options.type,
		status: options.status,
		priority: options.priority ?? null,
		assignee: options.assignee ?? null,
		epic: options.epic ?? null,
		estimate: options.estimate ?? null,
		flagged: options.flagged ?? false,
		rank: null,
		sprintId: options.sprintId ?? null,
		columnId: options.columnId ?? null,
	};
}

export function createDemoColumns(): DemoColumn[] {
	return [
		{
			id: "todo",
			name: "To Do",
			statuses: [{ id: "status-todo", name: "To Do", category: "new" }],
		},
		{
			id: "progress",
			name: "In Progress",
			statuses: [
				{
					id: "status-progress",
					name: "In Progress",
					category: "indeterminate",
				},
				{
					id: "status-review",
					name: "In Review",
					category: "indeterminate",
				},
			],
		},
		{
			id: "done",
			name: "Done",
			statuses: [{ id: "status-done", name: "Done", category: "done" }],
		},
	];
}

export function createDemoLanes(columns: DemoColumn[]): DemoLane[] {
	const todo = columns[0].statuses[0];
	const progress = columns[1].statuses[0];
	const review = columns[1].statuses[1];
	const done = columns[2].statuses[0];
	return [
		{
			id: "platform",
			name: "Platform",
			cards: [
				issue("DND-101", "Cache the board payload per request", {
					type: types.task,
					status: todo,
					priority: priorities.high,
					assignee: users.ada,
					epic: epics.faster,
					estimate: 3,
					columnId: "todo",
					sprintId: "sprint-12",
				}),
				issue("DND-104", "Show the drop indicator on the target", {
					type: types.story,
					status: todo,
					priority: priorities.medium,
					assignee: users.grace,
					epic: epics.keyboard,
					estimate: 2,
					columnId: "todo",
					sprintId: "sprint-12",
				}),
				issue("DND-102", "Keep focus on the dragged card", {
					type: types.task,
					status: progress,
					priority: priorities.medium,
					assignee: users.grace,
					epic: epics.keyboard,
					estimate: 5,
					flagged: true,
					columnId: "progress",
					sprintId: "sprint-12",
				}),
				issue("DND-105", "Narrow the review column", {
					type: types.task,
					status: review,
					priority: priorities.low,
					assignee: users.ada,
					epic: epics.faster,
					estimate: 1,
					columnId: "progress",
					sprintId: "sprint-12",
				}),
				issue("DND-103", "Trim the drag preview to one card", {
					type: types.bug,
					status: done,
					priority: priorities.low,
					assignee: users.linus,
					epic: epics.faster,
					estimate: 2,
					columnId: "done",
					sprintId: "sprint-12",
				}),
			],
		},
		{
			id: "operations",
			name: "Operations",
			cards: [
				issue("DND-201", "Remember the last board filter", {
					type: types.task,
					status: todo,
					priority: priorities.low,
					assignee: users.ada,
					estimate: 1,
					columnId: "todo",
					sprintId: "sprint-12",
				}),
				issue("DND-202", "Collapse empty swimlanes", {
					type: types.task,
					status: progress,
					priority: priorities.medium,
					epic: epics.hygiene,
					estimate: 3,
					columnId: "progress",
					sprintId: "sprint-12",
				}),
				issue("DND-203", "Log a dropped card once", {
					type: types.bug,
					status: done,
					priority: priorities.high,
					assignee: users.grace,
					epic: epics.hygiene,
					estimate: 2,
					columnId: "done",
					sprintId: "sprint-12",
				}),
			],
		},
	];
}

export function createDemoSprints(): DemoSprint[] {
	const todo: StatusRef = {
		id: "status-todo",
		name: "To Do",
		category: "new",
	};
	const progress: StatusRef = {
		id: "status-progress",
		name: "In Progress",
		category: "indeterminate",
	};
	return [
		{
			id: "sprint-12",
			name: "Sprint 12",
			state: "active",
			issues: [
				issue("DND-301", "Prepare the sprint board", {
					type: types.task,
					status: todo,
					priority: priorities.high,
					assignee: users.ada,
					epic: epics.faster,
					estimate: 3,
					sprintId: "sprint-12",
				}),
				issue("DND-302", "Check the keyboard path", {
					type: types.story,
					status: todo,
					priority: priorities.medium,
					assignee: users.grace,
					epic: epics.keyboard,
					estimate: 2,
					sprintId: "sprint-12",
				}),
				issue("DND-303", "Review the drop indicator", {
					type: types.bug,
					status: progress,
					priority: priorities.low,
					assignee: users.linus,
					epic: epics.faster,
					estimate: 5,
					sprintId: "sprint-12",
				}),
			],
		},
		{
			id: "sprint-13",
			name: "Sprint 13",
			state: "future",
			issues: [
				issue("DND-401", "Plan the next increment", {
					type: types.task,
					status: todo,
					priority: priorities.medium,
					assignee: users.ada,
					epic: epics.hygiene,
					estimate: 8,
					sprintId: "sprint-13",
				}),
				issue("DND-402", "Split the reporting epic", {
					type: types.story,
					status: todo,
					priority: priorities.low,
					assignee: users.grace,
					estimate: 3,
					sprintId: "sprint-13",
				}),
			],
		},
	];
}

export function createDemoBacklog(): BoardIssue[] {
	const todo: StatusRef = {
		id: "status-todo",
		name: "To Do",
		category: "new",
	};
	return [
		issue("DND-501", "Triage the imported backlog", {
			type: types.task,
			status: todo,
			priority: priorities.medium,
			assignee: users.ada,
			estimate: 1,
		}),
		issue("DND-502", "Write the release note", {
			type: types.story,
			status: todo,
			priority: priorities.low,
			assignee: users.grace,
			epic: epics.faster,
			estimate: 2,
		}),
		issue("DND-503", "Check the empty state", {
			type: types.bug,
			status: todo,
			priority: priorities.high,
			assignee: users.linus,
			estimate: 1,
		}),
	];
}

export function estimateTotals(issues: BoardIssue[]): EstimateTotals {
	return issues.reduce<EstimateTotals>(
		(totals, issue) => {
			totals[issue.status.category] += 1;
			return totals;
		},
		{ new: 0, indeterminate: 0, done: 0 },
	);
}
