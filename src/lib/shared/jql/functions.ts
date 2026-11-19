export interface JqlFunctionSpec {
	minArgs: number;
	maxArgs: number;
}

export const JQL_FUNCTIONS: Record<string, JqlFunctionSpec> = {
	currentuser: { minArgs: 0, maxArgs: 0 },
	now: { minArgs: 0, maxArgs: 0 },
	startofday: { minArgs: 0, maxArgs: 1 },
	startofweek: { minArgs: 0, maxArgs: 1 },
	startofmonth: { minArgs: 0, maxArgs: 1 },
	startofyear: { minArgs: 0, maxArgs: 1 },
	endofday: { minArgs: 0, maxArgs: 1 },
	endofweek: { minArgs: 0, maxArgs: 1 },
	endofmonth: { minArgs: 0, maxArgs: 1 },
	endofyear: { minArgs: 0, maxArgs: 1 },
	membersof: { minArgs: 1, maxArgs: 1 },
	subtaskissuetypes: { minArgs: 0, maxArgs: 0 },
	standardissuetypes: { minArgs: 0, maxArgs: 0 },
	opensprints: { minArgs: 0, maxArgs: 0 },
	closedsprints: { minArgs: 0, maxArgs: 0 },
	futuresprints: { minArgs: 0, maxArgs: 0 },
	linkedissues: { minArgs: 1, maxArgs: 2 },
	releasedversions: { minArgs: 0, maxArgs: 0 },
	unreleasedversions: { minArgs: 0, maxArgs: 0 },
	updatedby: { minArgs: 1, maxArgs: 3 },
};

/** Words that cannot be used as bare field names or bare values. */
export const JQL_RESERVED_WORDS = new Set([
	"and",
	"or",
	"not",
	"in",
	"is",
	"was",
	"changed",
	"from",
	"to",
	"by",
	"after",
	"before",
	"on",
	"during",
	"order",
	"asc",
	"desc",
	"empty",
	"null",
]);
