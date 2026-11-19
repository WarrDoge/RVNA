import type { Comment, HistoryEntry, Worklog } from "#lib/api-types.ts";

/** The customer-request fields the activity module needs for internal notes. */
export type IssueActivityServiceDesk = {
	requestType: { id: string; name: string } | null;
	channel: string | null;
	portalId: string | null;
	customerUrl: string | null;
	isAgent: boolean;
};

/** What `loadIssueActivity` returns and the activity modules render. */
export type IssueActivityData = {
	comments: Comment[];
	worklogs: Worklog[];
	history: HistoryEntry[];
};
