import type { BacklogData, BoardConfig } from "#lib/api-types.ts";

export type BacklogPageFilter = {
	id: string;
	name: string;
	sequence: number;
};

export type BacklogPageBoard = Omit<
	BoardConfig,
	"filterJql" | "subFilterJql" | "swimlanes" | "quickFilters"
> & {
	quickFilters: BacklogPageFilter[];
};

/** The backlog the page renders; JQL is server-only and never reaches the browser. */
export type BacklogPageData = Omit<BacklogData, "board" | "quickFilters"> & {
	board: BacklogPageBoard;
	quickFilters: BacklogPageFilter[];
	sprintPermissions: {
		manage: boolean;
		editText: boolean;
		startStop: boolean;
	};
};
