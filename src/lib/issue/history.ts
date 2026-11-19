import type { HistoryItem } from "#lib/api-types.ts";
import { formatDuration } from "#lib/dates.ts";

const fieldLabels: Record<string, string> = {
	status: "status",
	resolution: "resolution",
	assignee: "assignee",
	reporter: "reporter",
	priority: "priority",
	summary: "summary",
	labels: "labels",
	duedate: "due date",
	timeestimate: "remaining estimate",
	timeoriginalestimate: "original estimate",
	timespent: "time spent",
	"story points": "story points",
	"epic link": "epic link",
	component: "components",
	"fix version": "fix versions",
	issuetype: "issue type",
	parent: "parent",
};

function clamp(value: string) {
	return value.length > 100 ? `${value.slice(0, 97)}…` : value;
}

function historyValue(field: string, value: string | null | undefined) {
	if (value === null || value === undefined || value === "") return "";
	if (field.toLowerCase().startsWith("time") && /^\d+$/.test(value)) {
		return formatDuration(Number(value));
	}
	return value;
}

export function describeHistoryItem(item: HistoryItem) {
	if (item.field === "description") return "changed the description";
	if (item.field === "Attachment") {
		return item.to || item.toText
			? "added an attachment"
			: "removed an attachment";
	}
	if (item.field === "Comment") return "added a comment";
	if (item.field === "Link") {
		const value = item.toText ?? item.to;
		return value ? `added a link: ${value}` : "removed a link";
	}

	const label = fieldLabels[item.field.toLowerCase()] ?? item.field;
	const from = clamp(historyValue(item.field, item.fromText ?? item.from));
	const to = clamp(historyValue(item.field, item.toText ?? item.to));

	if (from === "" && to === "") return `updated ${label}`;
	if (from === "") return `set ${label} to ${to}`;
	if (to === "") return `removed ${label}`;
	return `changed ${label} from ${from} to ${to}`;
}
