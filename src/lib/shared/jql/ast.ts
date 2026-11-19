export interface JqlPosition {
	line: number;
	character: number;
}

export interface JqlFieldRef {
	name: string;
	customId: number | null;
	position: JqlPosition;
}

export type JqlComparisonOperator =
	| "="
	| "!="
	| "~"
	| "!~"
	| ">"
	| ">="
	| "<"
	| "<="
	| "in"
	| "not in"
	| "is"
	| "is not";

export type JqlHistoryOperator =
	| "was"
	| "was not"
	| "was in"
	| "was not in"
	| "changed";

export interface JqlStringOperand {
	kind: "string";
	value: string;
	quoted: boolean;
	position: JqlPosition;
}

export interface JqlNumberOperand {
	kind: "number";
	value: number;
	text: string;
	position: JqlPosition;
}

export interface JqlEmptyOperand {
	kind: "empty";
	position: JqlPosition;
}

export interface JqlListOperand {
	kind: "list";
	values: JqlOperand[];
	position: JqlPosition;
}

export interface JqlFunctionOperand {
	kind: "function";
	name: string;
	args: JqlOperand[];
	position: JqlPosition;
}

export type JqlOperand =
	| JqlStringOperand
	| JqlNumberOperand
	| JqlEmptyOperand
	| JqlListOperand
	| JqlFunctionOperand;

export interface JqlClause {
	kind: "clause";
	field: JqlFieldRef;
	operator: JqlComparisonOperator;
	operand: JqlOperand;
}

export interface JqlHistoryClause {
	kind: "history";
	field: JqlFieldRef;
	operator: JqlHistoryOperator;
	values: JqlOperand[];
	from: JqlOperand | null;
	to: JqlOperand | null;
	by: JqlOperand | null;
	after: JqlOperand | null;
	before: JqlOperand | null;
	on: JqlOperand | null;
	during: [JqlOperand, JqlOperand] | null;
}

export interface JqlAnd {
	kind: "and";
	left: JqlNode;
	right: JqlNode;
}

export interface JqlOr {
	kind: "or";
	left: JqlNode;
	right: JqlNode;
}

export interface JqlNot {
	kind: "not";
	operand: JqlNode;
}

export type JqlNode = JqlAnd | JqlOr | JqlNot | JqlClause | JqlHistoryClause;

export interface JqlOrderBy {
	field: JqlFieldRef;
	direction: "asc" | "desc";
}

export interface JqlQuery {
	where: JqlNode | null;
	orderBy: JqlOrderBy[];
}
