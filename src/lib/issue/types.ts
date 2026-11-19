import type { Snippet } from "svelte";

/** The customer-request panel of a service desk issue, as the REST endpoint returns it. */
export type ServiceDeskRequest = {
	requestType: { id: string; name: string } | null;
	channel: string | null;
	portalId: string | null;
	customerUrl: string | null;
	isAgent: boolean;
};

/** One entry of the `.` actions menu. */
export type ShortcutAction = {
	id: string;
	label: string;
	keys?: string;
	run: () => void;
};

/** Position of the issue in the navigator detail pane and its arrows. */
export type IssueNavigation = {
	position: number;
	total: number;
	onPrevious: () => void;
	onNext: () => void;
};

/** One label/value cell pair of the Details grid. */
export type DetailPair = {
	label?: string;
	value?: string | Snippet | null;
	required?: boolean;
	testId?: string;
};
