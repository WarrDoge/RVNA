import type { UserRef } from "#lib/api-types.ts";

export type Gadget = {
	id: string;
	sourceId: string | null;
	type: string;
	title: string | null;
	column: number;
	row: number;
	color: string;
	refreshSeconds: number;
	config: Record<string, unknown>;
};

export type Dashboard = {
	id: string;
	sourceId: string | null;
	name: string;
	description: string | null;
	layout: string;
	shared: boolean;
	owner: UserRef;
	favourite: boolean;
	favouriteCount: number;
	gadgetCount: number;
	canEdit: boolean;
	createdAt: string;
	updatedAt: string;
};

export type DashboardDetail = Dashboard & { gadgets: Gadget[] };

export type GadgetIssue = {
	id: string;
	key: string;
	summary: string;
	type: { id: string; name: string; subtask: boolean };
	status: { id: string; name: string; category: string };
	priority: { id: string; name: string; iconColor: string | null } | null;
	resolution: { id: string; name: string } | null;
	assignee: UserRef | null;
	reporter: UserRef | null;
	created: string | null;
	updated: string | null;
	resolved: string | null;
	dueDate: string | null;
	labels: string[];
	components: string[];
	fixVersions: string[];
	affectsVersions: string[];
	sprint: string | null;
	epic: { key: string; summary: string } | null;
	parent: { key: string; summary: string } | null;
	project: { key: string; name: string };
	creator: UserRef | null;
	storyPoints: number | null;
	timeSpent: number | null;
	originalEstimate: number | null;
	remainingEstimate: number | null;
};

export type GadgetData = {
	kind: string;
	title: string;
	config: Record<string, unknown>;
	refreshSeconds: number;
	issueList?: {
		startAt: number;
		maxResults: number;
		total: number;
		issues: GadgetIssue[];
	};
	slices?: { label: string; value: number }[];
	matrix?: {
		columns: string[];
		rows: { label: string; cells: number[]; total: number }[];
		totals: number[];
		total: number;
	};
	series?: { days: string[]; created: number[]; resolved: number[] };
	activity?: {
		day: string;
		entries: {
			kind: "comment" | "history" | "created";
			issueKey: string;
			issueSummary: string;
			author: UserRef | null;
			created: string;
			text: string | null;
		}[];
	}[];
	filters?: {
		id: string;
		name: string;
		description: string | null;
		total: number;
	}[];
	links?: { title: string; url: string }[];
	html?: string;
};

export type GadgetDataEntry = { data: GadgetData } | { error: string };
