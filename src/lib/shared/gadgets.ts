/**
 * The gadget catalogue shared by the dashboard pages and the API. Jira names
 * its gadgets by title, so `title` here is the Jira title as well as the label
 * the picker shows.
 */

export type GadgetType =
	| "introduction"
	| "assigned-to-me"
	| "watched-issues"
	| "filter-results"
	| "activity-stream"
	| "pie-chart"
	| "two-dimensional"
	| "created-vs-resolved"
	| "issue-statistics"
	| "favourite-filters"
	| "quick-links";

export const GADGET_TYPES: {
	type: GadgetType;
	title: string;
	description: string;
}[] = [
	{
		type: "assigned-to-me",
		title: "Assigned to Me",
		description: "The issues assigned to you that are still open.",
	},
	{
		type: "activity-stream",
		title: "Activity Stream",
		description: "Recent issue activity, grouped by day.",
	},
	{
		type: "created-vs-resolved",
		title: "Created vs Resolved",
		description: "Issues created and resolved per day.",
	},
	{
		type: "favourite-filters",
		title: "Favourite Filters",
		description: "Your favourite saved filters.",
	},
	{
		type: "filter-results",
		title: "Filter Results",
		description: "The issues a saved filter returns, with paging.",
	},
	{
		type: "introduction",
		title: "Introduction",
		description: "Free text for everyone who opens the dashboard.",
	},
	{
		type: "issue-statistics",
		title: "Issue Statistics",
		description: "Issues counted by one statistic.",
	},
	{
		type: "pie-chart",
		title: "Pie Chart",
		description: "Issues counted by one statistic, as a pie.",
	},
	{
		type: "quick-links",
		title: "Quick Links",
		description: "A list of links you keep next to your issues.",
	},
	{
		type: "two-dimensional",
		title: "Two Dimensional Filter Statistics",
		description: "Two statistics of one set of issues as a table.",
	},
	{
		type: "watched-issues",
		title: "Watched Issues",
		description: "The issues you watch.",
	},
];

export const GADGET_TITLES = new Map(
	GADGET_TYPES.map((gadget) => [gadget.type, gadget.title]),
);

export function gadgetTitle(type: string) {
	return GADGET_TITLES.get(type as GadgetType) ?? type;
}

const LINK_BASE = new URL("https://rvna.invalid/");
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Stored Quick Links may only point at the web, mail or a path on this site. */
export function isSafeLinkUrl(value: string) {
	const trimmed = value.trim();
	if (trimmed === "") return false;
	for (const character of trimmed) {
		const code = character.charCodeAt(0);
		if (code < 0x20 || code === 0x7f || character === "\\") return false;
	}
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
		try {
			return LINK_PROTOCOLS.has(new URL(trimmed).protocol);
		} catch {
			return false;
		}
	}
	try {
		return new URL(trimmed, LINK_BASE).origin === LINK_BASE.origin;
	} catch {
		return false;
	}
}

export type StatisticType =
	| "status"
	| "priority"
	| "type"
	| "assignee"
	| "reporter"
	| "project"
	| "resolution"
	| "component"
	| "label"
	| "fixVersion";

export const STATISTICS: { value: StatisticType; label: string }[] = [
	{ value: "status", label: "Status" },
	{ value: "priority", label: "Priority" },
	{ value: "type", label: "Issue Type" },
	{ value: "assignee", label: "Assignee" },
	{ value: "reporter", label: "Reporter" },
	{ value: "project", label: "Project" },
	{ value: "resolution", label: "Resolution" },
	{ value: "component", label: "Component" },
	{ value: "label", label: "Labels" },
	{ value: "fixVersion", label: "Fix Version" },
];

export type DashboardLayout = "A" | "AA" | "AB" | "BA" | "AAA";

export const DASHBOARD_LAYOUTS: {
	value: DashboardLayout;
	label: string;
	columns: number;
}[] = [
	{ value: "A", label: "One column", columns: 1 },
	{ value: "AA", label: "Two columns, equal", columns: 2 },
	{ value: "AB", label: "Two columns, narrow left", columns: 2 },
	{ value: "BA", label: "Two columns, narrow right", columns: 2 },
	{ value: "AAA", label: "Three columns", columns: 3 },
];

export function layoutColumns(layout: DashboardLayout) {
	return DASHBOARD_LAYOUTS.find((item) => item.value === layout)?.columns ?? 2;
}

/** Column widths in fractions, as Jira lays them out. */
export function layoutWidths(layout: DashboardLayout) {
	switch (layout) {
		case "A":
			return [1];
		case "AB":
			return [0.35, 0.65];
		case "BA":
			return [0.65, 0.35];
		case "AAA":
			return [1 / 3, 1 / 3, 1 / 3];
		default:
			return [0.5, 0.5];
	}
}

export const GADGET_COLORS = [
	{ value: "color1", label: "Default", background: "elevation.surface" },
	{
		value: "color2",
		label: "Blue",
		background: "color.background.accent.blue.subtlest",
	},
	{
		value: "color3",
		label: "Green",
		background: "color.background.accent.green.subtlest",
	},
	{
		value: "color4",
		label: "Yellow",
		background: "color.background.accent.yellow.subtlest",
	},
	{
		value: "color5",
		label: "Red",
		background: "color.background.accent.red.subtlest",
	},
	{
		value: "color6",
		label: "Purple",
		background: "color.background.accent.purple.subtlest",
	},
] as const;

export const DEFAULT_COLUMNS = ["type", "key", "summary", "priority", "status"];

export interface FilterResultsConfig {
	filterId: string | null;
	columns: string[];
	rows: number;
}

export interface IssueListConfig {
	columns: string[];
	rows: number;
	showResolved: boolean;
}

export interface ActivityStreamConfig {
	projects: string[];
	users: string[];
	days: number;
	rows: number;
}

export interface StatisticConfig {
	statistic: StatisticType;
	filterId: string | null;
	project: string | null;
}

export interface TwoDimensionalConfig {
	xStatistic: StatisticType;
	yStatistic: StatisticType;
	filterId: string | null;
	project: string | null;
}

export interface CreatedResolvedConfig {
	filterId: string | null;
	project: string | null;
	days: number;
}

export interface IntroductionConfig {
	html: string;
}

export interface QuickLinksConfig {
	links: { title: string; url: string }[];
}

export type GadgetConfig =
	| FilterResultsConfig
	| IssueListConfig
	| ActivityStreamConfig
	| StatisticConfig
	| TwoDimensionalConfig
	| CreatedResolvedConfig
	| IntroductionConfig
	| QuickLinksConfig
	| Record<string, never>;
