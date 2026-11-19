import { param, type SQL, sql } from "drizzle-orm";
import {
	builtinFieldId,
	type JqlClause,
	type JqlComparisonOperator,
	JqlError,
	type JqlFieldRef,
	type JqlFunctionOperand,
	type JqlHistoryClause,
	type JqlNode,
	type JqlOperand,
	type JqlOrderBy,
	type JqlPosition,
	type JqlQuery,
} from "../../shared/jql/index.ts";
import { isVisibleCustomField } from "../custom-fields.ts";
import { db } from "../db.ts";
import { dateContext } from "../request-context.ts";
import {
	agentProjectIds,
	readableCommentCondition,
} from "../servicedesk/access.ts";
import { type JqlCatalog, loadCatalog } from "./catalog.ts";

export interface SearchUser {
	id: string;
	username: string;
	groups?: string[];
	isAdmin?: boolean;
}

export const ALL_PROJECTS = "all" as const;

/** The projects a query may see: the viewer's, or every project for work done without a viewer. */
export type VisibleProjects = string[] | typeof ALL_PROJECTS;

export interface CompileOptions {
	user: SearchUser | null;
	now?: Date;
	/** The zone of date-only literals and the start/end date functions. */
	timeZone?: string;
	catalog?: JqlCatalog;
	visibleProjectIds: VisibleProjects;
}

export interface CompiledJql {
	where: SQL | null;
	orderBy: SQL[];
}

type FieldType = "text" | "numeric" | "timestamp" | "date";

type SqlValue = string | number | Date | boolean;

type Literal =
	| { kind: "string"; value: string }
	| { kind: "number"; value: number }
	| { kind: "date"; value: Date; dateOnly: boolean };

interface FieldSpec {
	id: string;
	display: string;
	type: FieldType;
	nullable?: boolean;
	duration?: boolean;
	/** Column type when it differs from the JQL value type, e.g. uuid ids. */
	cast?: "uuid";
	scalar?: SQL;
	/** Compared with OR for equality, AND for inequality. Used by cascading selects. */
	columns?: SQL[];
	multi?: SQL;
	order?: SQL | null;
	contains?: (value: SQL, pattern: SQL) => SQL;
	multiContains?: (pattern: SQL) => SQL;
	ops?: JqlComparisonOperator[];
	resolveValue?: (
		literal: Literal,
		position: JqlPosition,
	) => Promise<SqlValue> | SqlValue;
	unresolved?: boolean;
	orderOnly?: boolean;
}

interface CompileContext {
	catalog: JqlCatalog;
	user: SearchUser | null;
	now: Date;
	timeZone: string;
	visibleProjectIds: VisibleProjects;
	/** Projects whose desk the viewer works; null without a viewer. */
	agentProjectIds: string[] | null;
}

const DEFAULT_TEXT_OPS: JqlComparisonOperator[] = [
	"=",
	"!=",
	"~",
	"!~",
	"in",
	"not in",
];

const DEFAULT_TEXT_OPS_NO_CONTAINS: JqlComparisonOperator[] = [
	"=",
	"!=",
	"in",
	"not in",
];

const DEFAULT_ORDERED_OPS: JqlComparisonOperator[] = [
	"=",
	"!=",
	">",
	">=",
	"<",
	"<=",
	"in",
	"not in",
];

const COMPARISON_KEYWORDS: Record<string, string> = {
	">": ">",
	">=": ">=",
	"<": "<",
	"<=": "<=",
};

const ARRAY_CASTS: Record<FieldType, string> = {
	text: "text[]",
	numeric: "double precision[]",
	timestamp: "timestamptz[]",
	date: "date[]",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local issues have `local:<uuid>` source ids, so only cast Jira's numeric ids. */
const NUMERIC_SOURCE_ID = sql`case when issues.source_id ~ '^[0-9]+$' then issues.source_id::bigint end`;
function visibleProjectCondition(ctx: CompileContext): SQL | null {
	if (ctx.visibleProjectIds === ALL_PROJECTS) return null;
	if (ctx.visibleProjectIds.length === 0) return sql`false`;
	return sql`issues.project_id = any(${param(ctx.visibleProjectIds)}::uuid[])`;
}

function valueError(display: string, value: string, position: JqlPosition) {
	return new JqlError(
		`The value '${value}' does not exist for the field '${display}'.`,
		position,
	);
}

function literalString(literal: Literal) {
	if (literal.kind === "string") return literal.value;
	if (literal.kind === "number") return String(literal.value);
	return undefined;
}

// --- dates and durations ---------------------------------------------------

const RELATIVE_DATE = /^([+-]?)((?:\d+(?:\.\d+)?[wdhm]\s*)+)$/;

const RELATIVE_PART = /(\d+(?:\.\d+)?)([wdhm])/g;

const ABSOLUTE_DATE =
	/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

function parseRelativeDate(text: string) {
	const match = RELATIVE_DATE.exec(text.trim());
	if (!match) return null;
	const sign = match[1] === "-" ? -1 : 1;
	let milliseconds = 0;
	for (const part of (match[2] as string).matchAll(RELATIVE_PART)) {
		const amount = Number(part[1]);
		switch (part[2]) {
			case "w":
				milliseconds += amount * 7 * DAY_MS;
				break;
			case "d":
				milliseconds += amount * DAY_MS;
				break;
			case "h":
				milliseconds += amount * 60 * 60 * 1000;
				break;
			default:
				milliseconds += amount * 60 * 1000;
				break;
		}
	}
	return sign * milliseconds;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string) {
	let formatter = zoneFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		zoneFormatters.set(timeZone, formatter);
	}
	return formatter;
}

function zoneParts(value: Date, timeZone: string) {
	const parts: Record<string, number> = {};
	for (const part of zoneFormatter(timeZone).formatToParts(value)) {
		if (part.type !== "literal") parts[part.type] = Number(part.value);
	}
	return {
		year: parts.year as number,
		month: parts.month as number,
		day: parts.day as number,
		hour: parts.hour as number,
		minute: parts.minute as number,
		second: parts.second as number,
	};
}

function zoneOffsetAt(instant: number, timeZone: string) {
	const parts = zoneParts(new Date(instant), timeZone);
	return (
		Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			parts.second,
		) - instant
	);
}

/** The instant whose wall clock in `timeZone` reads the given local time. */
function zonedInstant(
	year: number,
	month: number,
	day: number,
	timeZone: string,
) {
	const wall = Date.UTC(year, month - 1, day);
	const first = wall - zoneOffsetAt(wall, timeZone);
	return wall - zoneOffsetAt(first, timeZone);
}

function parseAbsoluteDate(text: string, timeZone: string) {
	const match = ABSOLUTE_DATE.exec(text.trim());
	if (!match) return null;
	if (match[4] === undefined) {
		return new Date(
			zonedInstant(
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
				timeZone,
			),
		);
	}
	const value = new Date(
		Date.UTC(
			Number(match[1]),
			Number(match[2]) - 1,
			Number(match[3]),
			Number(match[4]),
			Number(match[5]),
			Number(match[6] ?? 0),
		),
	);
	if (Number.isNaN(value.getTime())) return null;
	return value;
}

/**
 * Relative offsets ("-7d", "1w 2d", "-60m") are measured from the compile
 * context's `now`; a date-only absolute value is midnight in the context's
 * time zone, and a value with a time keeps its UTC reading.
 */
function parseDateValue(literal: Literal, now: Date, timeZone: string) {
	if (literal.kind === "date") {
		return literal.dateOnly
			? new Date(
					zonedInstant(
						literal.value.getUTCFullYear(),
						literal.value.getUTCMonth() + 1,
						literal.value.getUTCDate(),
						timeZone,
					),
				)
			: literal.value;
	}
	const text =
		literal.kind === "string" ? literal.value : String(literal.value);
	const relative = parseRelativeDate(text);
	if (relative !== null) return new Date(now.getTime() + relative);
	return parseAbsoluteDate(text, timeZone);
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
	w: 5 * 8 * 60 * 60,
	d: 8 * 60 * 60,
	h: 60 * 60,
	m: 60,
};

/** Jira durations: 1w = 5 workdays, 1d = 8h, 1h, 1m. */
function parseDurationValue(text: string) {
	const trimmed = text.trim();
	if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
	if (!/^(?:\d+(?:\.\d+)?[wdhm]\s*)+$/.test(trimmed)) return null;
	let seconds = 0;
	for (const part of trimmed.matchAll(/(\d+(?:\.\d+)?)([wdhm])/g)) {
		seconds +=
			Number(part[1]) * (DURATION_UNIT_SECONDS[part[2] as string] ?? 0);
	}
	return seconds;
}

function isoDayInZone(value: Date, timeZone: string) {
	const parts = zoneParts(value, timeZone);
	return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

// --- operand and function evaluation --------------------------------------

async function operandLiterals(
	operand: JqlOperand,
	ctx: CompileContext,
): Promise<Literal[]> {
	if (operand.kind === "empty") {
		throw new JqlError("Expecting a value but got 'EMPTY'.", operand.position);
	}
	if (operand.kind === "list") {
		const values: Literal[] = [];
		for (const item of operand.values) {
			values.push(...(await operandLiterals(item, ctx)));
		}
		return values;
	}
	if (operand.kind === "function") {
		return evaluateFunction(operand, ctx);
	}
	if (operand.kind === "number") {
		return [{ kind: "number", value: operand.value }];
	}
	return [{ kind: "string", value: operand.value }];
}

async function comparisonLiterals(
	operand: JqlOperand,
	ctx: CompileContext,
): Promise<{ literals: Literal[]; empty: boolean }> {
	if (operand.kind !== "list") {
		return { literals: await operandLiterals(operand, ctx), empty: false };
	}
	const literals: Literal[] = [];
	let empty = false;
	for (const item of operand.values) {
		if (item.kind === "empty") {
			empty = true;
			continue;
		}
		literals.push(...(await operandLiterals(item, ctx)));
	}
	return { literals, empty };
}

async function singleLiteral(operand: JqlOperand, ctx: CompileContext) {
	const values = await operandLiterals(operand, ctx);
	if (values.length !== 1) {
		throw new JqlError(
			"Expecting a single value but got a list.",
			operand.position,
		);
	}
	return values[0] as Literal;
}

async function singleArgument(
	operand: JqlOperand | undefined,
	ctx: CompileContext,
) {
	if (!operand) return null;
	return singleLiteral(operand, ctx);
}

function startOfDay(value: Date, offsetDays: number, timeZone: string) {
	const parts = zoneParts(value, timeZone);
	const day = new Date(
		Date.UTC(parts.year, parts.month - 1, parts.day + offsetDays),
	);
	return new Date(
		zonedInstant(
			day.getUTCFullYear(),
			day.getUTCMonth() + 1,
			day.getUTCDate(),
			timeZone,
		),
	);
}

function startOfWeek(value: Date, offsetWeeks: number, timeZone: string) {
	const parts = zoneParts(value, timeZone);
	const day = Date.UTC(parts.year, parts.month - 1, parts.day);
	const weekday = (new Date(day).getUTCDay() + 6) % 7;
	const target = new Date(day - weekday * DAY_MS + offsetWeeks * 7 * DAY_MS);
	return new Date(
		zonedInstant(
			target.getUTCFullYear(),
			target.getUTCMonth() + 1,
			target.getUTCDate(),
			timeZone,
		),
	);
}

function startOfMonth(value: Date, offsetMonths: number, timeZone: string) {
	const parts = zoneParts(value, timeZone);
	const target = new Date(
		Date.UTC(parts.year, parts.month - 1 + offsetMonths, 1),
	);
	return new Date(
		zonedInstant(
			target.getUTCFullYear(),
			target.getUTCMonth() + 1,
			1,
			timeZone,
		),
	);
}

function startOfYear(value: Date, offsetYears: number, timeZone: string) {
	const parts = zoneParts(value, timeZone);
	return new Date(zonedInstant(parts.year + offsetYears, 1, 1, timeZone));
}

async function evaluateFunction(
	fn: JqlFunctionOperand,
	ctx: CompileContext,
): Promise<Literal[]> {
	const name = fn.name;
	const offsetArgument = await singleArgument(fn.args[0], ctx);
	const offset =
		offsetArgument === null
			? 0
			: offsetArgument.kind === "number"
				? offsetArgument.value
				: Number(literalString(offsetArgument) ?? "0");

	switch (name) {
		case "currentuser":
			if (!ctx.user) {
				throw new JqlError(
					"Function 'currentUser()' requires a logged in user.",
					fn.position,
				);
			}
			return [{ kind: "string", value: ctx.user.username }];
		case "now":
			return [{ kind: "date", value: ctx.now, dateOnly: false }];
		case "startofday":
			return [
				{
					kind: "date",
					value: startOfDay(ctx.now, offset, ctx.timeZone),
					dateOnly: false,
				},
			];
		case "startofweek":
			return [
				{
					kind: "date",
					value: startOfWeek(ctx.now, offset, ctx.timeZone),
					dateOnly: false,
				},
			];
		case "startofmonth":
			return [
				{
					kind: "date",
					value: startOfMonth(ctx.now, offset, ctx.timeZone),
					dateOnly: false,
				},
			];
		case "startofyear":
			return [
				{
					kind: "date",
					value: startOfYear(ctx.now, offset, ctx.timeZone),
					dateOnly: false,
				},
			];
		case "endofday": {
			const next = startOfDay(ctx.now, offset + 1, ctx.timeZone);
			return [
				{
					kind: "date",
					value: new Date(next.getTime() - 1),
					dateOnly: false,
				},
			];
		}
		case "endofweek": {
			const next = startOfWeek(ctx.now, offset + 1, ctx.timeZone);
			return [
				{
					kind: "date",
					value: new Date(next.getTime() - 1),
					dateOnly: false,
				},
			];
		}
		case "endofmonth": {
			const next = startOfMonth(ctx.now, offset + 1, ctx.timeZone);
			return [
				{
					kind: "date",
					value: new Date(next.getTime() - 1),
					dateOnly: false,
				},
			];
		}
		case "endofyear": {
			const next = startOfYear(ctx.now, offset + 1, ctx.timeZone);
			return [
				{
					kind: "date",
					value: new Date(next.getTime() - 1),
					dateOnly: false,
				},
			];
		}
		case "membersof": {
			const group = literalString(
				offsetArgument ?? { kind: "string", value: "" },
			);
			const found = ctx.catalog.groups.find(
				(item) => item.name.toLowerCase() === (group ?? "").toLowerCase(),
			);
			if (!found) {
				throw new JqlError(`The group '${group}' does not exist.`, fn.position);
			}
			const result = await db.execute(
				sql`select u.username from user_groups ug join users u on u.id = ug.user_id where ug.group_id = ${found.id} order by u.username`,
			);
			return (result.rows as { username: string }[]).map((row) => ({
				kind: "string" as const,
				value: row.username,
			}));
		}
		case "subtaskissuetypes":
			return ctx.catalog.issueTypes
				.filter((item) => item.subtask)
				.map((item) => ({ kind: "string" as const, value: item.name }));
		case "standardissuetypes":
			return ctx.catalog.issueTypes
				.filter((item) => !item.subtask)
				.map((item) => ({ kind: "string" as const, value: item.name }));
		case "opensprints":
			return sprintNames(ctx.catalog, "ACTIVE");
		case "closedsprints":
			return sprintNames(ctx.catalog, "CLOSED");
		case "futuresprints":
			return sprintNames(ctx.catalog, "FUTURE");
		case "linkedissues":
			return linkedIssues(fn, ctx);
		case "releasedversions":
			return ctx.catalog.versions
				.filter((item) => item.released)
				.map((item) => ({ kind: "string" as const, value: item.name }));
		case "unreleasedversions":
			return ctx.catalog.versions
				.filter((item) => !item.released)
				.map((item) => ({ kind: "string" as const, value: item.name }));
		case "updatedby":
			return updatedBy(fn, ctx);
		default:
			throw new JqlError(`Function '${fn.name}' does not exist.`, fn.position);
	}
}

function sprintNames(catalog: JqlCatalog, state: string): Literal[] {
	return catalog.sprints
		.filter((sprint) => sprint.state === state)
		.map((sprint) => ({ kind: "string" as const, value: sprint.name }));
}

async function linkedIssues(
	fn: JqlFunctionOperand,
	ctx: CompileContext,
): Promise<Literal[]> {
	const keyArgument = await singleArgument(fn.args[0], ctx);
	const key = keyArgument ? literalString(keyArgument) : undefined;
	if (!key) {
		throw new JqlError("Expecting an issue key.", fn.position);
	}

	const visible = visibleProjectCondition(ctx);
	const found = await db.execute(
		sql`select id from issues where lower(key) = lower(${key})${visible ? sql` and ${visible}` : sql``} limit 1`,
	);
	const issue = (found.rows as { id: string }[])[0];
	if (!issue) {
		throw new JqlError(`Issue '${key}' does not exist.`, fn.position);
	}

	let linkType: string | null = null;
	if (fn.args.length > 1) {
		const typeArgument = await singleArgument(fn.args[1], ctx);
		linkType = typeArgument ? (literalString(typeArgument) ?? null) : null;
	}

	const rows = linkType
		? await db.execute(sql`
			select other.key
			from issue_links il
			join issues other on other.id = case
				when il.source_issue_id = ${issue.id} then il.target_issue_id
				else il.source_issue_id
			end
			join link_types lt on lt.id = il.type_id
			where (il.source_issue_id = ${issue.id} or il.target_issue_id = ${issue.id})
				and (lower(lt.name) = lower(${linkType})
					or lower(lt.inward) = lower(${linkType})
					or lower(lt.outward) = lower(${linkType}))
				${visible ? sql`and other.project_id = any(${param(ctx.visibleProjectIds === ALL_PROJECTS ? [] : ctx.visibleProjectIds)}::uuid[])` : sql``}
			order by other.key
		`)
		: await db.execute(sql`
			select other.key
			from issue_links il
			join issues other on other.id = case
				when il.source_issue_id = ${issue.id} then il.target_issue_id
				else il.source_issue_id
			end
			where (il.source_issue_id = ${issue.id} or il.target_issue_id = ${issue.id})
				${visible ? sql`and other.project_id = any(${param(ctx.visibleProjectIds === ALL_PROJECTS ? [] : ctx.visibleProjectIds)}::uuid[])` : sql``}
			order by other.key
		`);

	return (rows.rows as { key: string }[]).map((row) => ({
		kind: "string" as const,
		value: row.key,
	}));
}

async function updatedBy(
	fn: JqlFunctionOperand,
	ctx: CompileContext,
): Promise<Literal[]> {
	const userArgument = await singleArgument(fn.args[0], ctx);
	const user = userArgument ? literalString(userArgument) : undefined;
	if (!user) throw new JqlError("Expecting a user.", fn.position);

	const found = findUser(ctx.catalog, user);
	if (!found) {
		throw new JqlError(`The user '${user}' does not exist.`, fn.position);
	}

	const from = await singleArgument(fn.args[1], ctx);
	const to = await singleArgument(fn.args[2], ctx);
	const fromDate = from ? parseDateValue(from, ctx.now, ctx.timeZone) : null;
	const toDate = to ? parseDateValue(to, ctx.now, ctx.timeZone) : null;

	const conditions: SQL[] = [
		sql`h.author_id = ${found.id}`,
		sql`issues.id = h.issue_id`,
	];
	const visible = visibleProjectCondition(ctx);
	if (visible) conditions.push(visible);
	if (fromDate) conditions.push(sql`h.created >= ${fromDate}`);
	if (toDate) conditions.push(sql`h.created <= ${toDate}`);

	const result = await db.execute(sql`
		select distinct issues.key
		from issue_history h
		join issues on issues.id = h.issue_id
		where ${sql.join(conditions, sql` and `)}
		order by issues.key
	`);
	return (result.rows as { key: string }[]).map((row) => ({
		kind: "string" as const,
		value: row.key,
	}));
}

// --- catalog helpers -------------------------------------------------------

function findUser(catalog: JqlCatalog, value: string) {
	const needle = value.toLowerCase();
	return catalog.users.find(
		(user) =>
			user.username.toLowerCase() === needle ||
			user.displayName.toLowerCase() === needle,
	);
}

function findProject(catalog: JqlCatalog, value: string) {
	const needle = value.toLowerCase();
	return catalog.projects.find(
		(project) =>
			project.key.toLowerCase() === needle ||
			project.name.toLowerCase() === needle ||
			project.id.toLowerCase() === needle,
	);
}

function findStatus(catalog: JqlCatalog, value: string) {
	const needle = value.toLowerCase();
	return catalog.statuses.find(
		(status) => status.name.toLowerCase() === needle,
	);
}

function normalizeStatusCategory(value: string) {
	const needle = value.toLowerCase().replace(/\s+/g, "");
	if (needle === "todo" || needle === "new") return "new";
	if (needle === "inprogress" || needle === "indeterminate") {
		return "indeterminate";
	}
	if (needle === "done") return "done";
	return null;
}

function findLinkType(catalog: JqlCatalog, value: string) {
	const needle = value.toLowerCase();
	return catalog.linkTypes.find(
		(type) =>
			type.name.toLowerCase() === needle ||
			type.inward.toLowerCase() === needle ||
			type.outward.toLowerCase() === needle,
	);
}

// --- field resolution ------------------------------------------------------

function customSpec(
	field: JqlCatalog["customFields"][number],
	catalog: JqlCatalog,
	position: JqlPosition,
): FieldSpec {
	const key = field.sourceId;
	const display = field.name;
	const type = field.type ?? "";
	const source = sql.raw(`'${key.replace(/'/g, "''")}'`);
	const unsupported = () =>
		new JqlError(`Field '${display}' cannot be searched.`, position);

	const optionValues = (value: string, at: JqlPosition) => {
		const options = catalog.fieldOptions
			.filter((option) => option.fieldId === field.id)
			.map((option) => option.value);
		const match = options.find(
			(item) => item.toLowerCase() === value.toLowerCase(),
		);
		if (!match) throw valueError(display, value, at);
		return match;
	};

	if (type === "string") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "text",
			nullable: true,
			scalar: sql`issues.custom->>${source}`,
			order: sql`(issues.custom->>${source})`,
			contains: (_value, pattern) =>
				sql`(issues.custom->>${source}) ilike ${pattern} escape '!'`,
		};
	}

	if (type === "number") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "numeric",
			nullable: true,
			scalar: sql`(issues.custom->>${source})::double precision`,
		};
	}

	if (type === "date") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "date",
			nullable: true,
			scalar: sql`(issues.custom->>${source})::date`,
		};
	}

	if (type === "datetime") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "timestamp",
			nullable: true,
			scalar: sql`(issues.custom->>${source})::timestamptz`,
		};
	}

	if (type === "option") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "text",
			nullable: true,
			scalar: sql`issues.custom->${source}->>'value'`,
			resolveValue: (literal, at) =>
				optionValues(literalString(literal) ?? "", at),
		};
	}

	if (type === "option-with-child") {
		return {
			id: `cf:${field.id}`,
			display,
			type: "text",
			nullable: true,
			columns: [
				sql`issues.custom->${source}->>'value'`,
				sql`issues.custom->${source}->'child'->>'value'`,
			],
			resolveValue: (literal, at) =>
				optionValues(literalString(literal) ?? "", at),
		};
	}

	if (type === "array") {
		const customKey = field.customKey ?? "";
		if (
			customKey.endsWith(":multiuserpicker") ||
			customKey.includes("sd-request-participants")
		) {
			return {
				id: `cf:${field.id}`,
				display,
				type: "text",
				nullable: true,
				multi: sql`select member->>'name' from jsonb_array_elements(coalesce(issues.custom->${source}, '[]'::jsonb)) as member`,
				order: sql`(select min(member->>'name') from jsonb_array_elements(coalesce(issues.custom->${source}, '[]'::jsonb)) as member)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const user = findUser(catalog, value);
					if (!user) throw valueError(display, value, at);
					return user.username;
				},
			};
		}
		if (customKey.endsWith(":gh-sprint")) {
			return sprintFieldSpec(`cf:${field.id}`, display, catalog);
		}
		throw unsupported();
	}

	if (type === "any" || type === "sd-servicelevelagreement") {
		throw unsupported();
	}

	throw unsupported();
}

function builtinSpec(
	id: string,
	display: string,
	catalog: JqlCatalog,
	position: JqlPosition,
	agentProjects: string[] | null,
): FieldSpec {
	const scalar = (
		expression: SQL,
		rest: Partial<FieldSpec> = {},
	): FieldSpec => ({
		id,
		display,
		type: "text",
		scalar: expression,
		...rest,
	});

	switch (id) {
		case "project":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.project_id`,
				cast: "uuid",
				order: sql`(select p.key from projects p where p.id = issues.project_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const project = findProject(catalog, value);
					if (!project) throw valueError(display, value, at);
					return project.id;
				},
			};
		case "issuetype":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.type_id`,
				cast: "uuid",
				order: sql`(select it.name from issue_types it where it.id = issues.type_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const type = catalog.issueTypes.find(
						(item) => item.name.toLowerCase() === value.toLowerCase(),
					);
					if (!type) throw valueError(display, value, at);
					return type.id;
				},
			};
		case "status":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.status_id`,
				cast: "uuid",
				order: sql`(select s.name from statuses s where s.id = issues.status_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const status = findStatus(catalog, value);
					if (!status) throw valueError(display, value, at);
					return status.id;
				},
			};
		case "statusCategory":
			return {
				id,
				display,
				type: "text",
				scalar: sql`(select s.category from statuses s where s.id = issues.status_id)`,
				order: sql`(select case s.category when 'new' then 0 when 'indeterminate' then 1 else 2 end from statuses s where s.id = issues.status_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const category = normalizeStatusCategory(value);
					if (!category) throw valueError(display, value, at);
					return category;
				},
			};
		case "priority":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.priority_id`,
				cast: "uuid",
				order: sql`(select p.sequence from priorities p where p.id = issues.priority_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const priority = catalog.priorities.find(
						(item) => item.name.toLowerCase() === value.toLowerCase(),
					);
					if (!priority) throw valueError(display, value, at);
					return priority.id;
				},
			};
		case "resolution":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				unresolved: true,
				scalar: sql`issues.resolution_id`,
				cast: "uuid",
				order: sql`(select r.name from resolutions r where r.id = issues.resolution_id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const resolution = catalog.resolutions.find(
						(item) => item.name.toLowerCase() === value.toLowerCase(),
					);
					if (!resolution) throw valueError(display, value, at);
					return resolution.id;
				},
			};
		case "assignee":
		case "reporter":
		case "creator":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				cast: "uuid",
				scalar: sql`issues.${sql.raw(id === "assignee" ? "assignee_id" : id === "reporter" ? "reporter_id" : "creator_id")}`,
				order: sql`(select u.display_name from users u where u.id = issues.${sql.raw(id === "assignee" ? "assignee_id" : id === "reporter" ? "reporter_id" : "creator_id")})`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const user = findUser(catalog, value);
					if (!user) throw valueError(display, value, at);
					return user.id;
				},
			};
		case "watcher":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				cast: "uuid",
				multi: sql`select w.user_id from watchers w where w.issue_id = issues.id`,
				order: sql`(select min(u.display_name) from watchers w join users u on u.id = w.user_id where w.issue_id = issues.id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const user = findUser(catalog, value);
					if (!user) throw valueError(display, value, at);
					return user.id;
				},
			};
		case "summary":
			return scalar(sql`issues.summary`, {
				order: sql`issues.summary`,
				contains: (_value, pattern) =>
					sql`issues.summary ilike ${pattern} escape '!'`,
			});
		case "description":
			return scalar(sql`issues.description_source`, {
				nullable: true,
				order: sql`issues.description_source`,
				contains: (_value, pattern) =>
					sql`issues.description_source ilike ${pattern} escape '!'`,
			});
		case "comment":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				multi: sql`select c.body_source from comments c where c.issue_id = issues.id and ${readableCommentCondition(sql`c.internal`, sql`issues.project_id`, agentProjects)}`,
				ops: ["~", "!~"],
				multiContains: (pattern) =>
					sql`case when exists (select 1 from comments c where c.issue_id = issues.id and ${readableCommentCondition(sql`c.internal`, sql`issues.project_id`, agentProjects)})
						then exists (select 1 from comments c where c.issue_id = issues.id and ${readableCommentCondition(sql`c.internal`, sql`issues.project_id`, agentProjects)} and c.body_source ilike ${pattern} escape '!')
						else null end`,
			};
		case "attachments":
			return {
				id,
				display,
				type: "text",
				multi: sql`select a.id from attachments a where a.issue_id = issues.id`,
				order: null,
				ops: [],
			};
		case "text":
			return {
				id,
				display,
				type: "text",
				ops: ["~", "!~"],
				contains: (value, pattern) =>
					sql`(issues.search @@ plainto_tsquery('simple', ${value})
						or issues.summary ilike ${pattern} escape '!'
						or exists (select 1 from comments c where c.issue_id = issues.id and ${readableCommentCondition(sql`c.internal`, sql`issues.project_id`, agentProjects)} and c.body_source ilike ${pattern} escape '!'))`,
			};
		case "labels":
			return {
				id,
				display,
				type: "text",
				multi: sql`select il.label from issue_labels il where il.issue_id = issues.id`,
				order: sql`(select min(il.label) from issue_labels il where il.issue_id = issues.id)`,
			};
		case "component":
			return {
				id,
				display,
				type: "text",
				multi: sql`select c.name from issue_components ic join components c on c.id = ic.component_id where ic.issue_id = issues.id`,
				order: sql`(select min(c.name) from issue_components ic join components c on c.id = ic.component_id where ic.issue_id = issues.id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const component = catalog.components.find(
						(item) => item.name.toLowerCase() === value.toLowerCase(),
					);
					if (!component) throw valueError(display, value, at);
					return component.name;
				},
			};
		case "fixVersion":
		case "affectedVersion":
			return {
				id,
				display,
				type: "text",
				multi:
					id === "fixVersion"
						? sql`select v.name from issue_fix_versions fv join versions v on v.id = fv.version_id where fv.issue_id = issues.id`
						: sql`select v.name from issue_affects_versions av join versions v on v.id = av.version_id where av.issue_id = issues.id`,
				order:
					id === "fixVersion"
						? sql`(select min(v.name) from issue_fix_versions fv join versions v on v.id = fv.version_id where fv.issue_id = issues.id)`
						: sql`(select min(v.name) from issue_affects_versions av join versions v on v.id = av.version_id where av.issue_id = issues.id)`,
				resolveValue: (literal, at) => {
					const value = literalString(literal) ?? "";
					const version = catalog.versions.find(
						(item) => item.name.toLowerCase() === value.toLowerCase(),
					);
					if (!version) throw valueError(display, value, at);
					return version.name;
				},
			};
		case "created":
		case "updated":
		case "resolved":
			return {
				id,
				display,
				type: "timestamp",
				nullable: id !== "created",
				scalar: sql`issues.${sql.raw(id)}`,
				order: sql`issues.${sql.raw(id)}`,
				ops: DEFAULT_ORDERED_OPS,
			};
		case "due":
			return {
				id,
				display,
				type: "date",
				nullable: true,
				scalar: sql`issues.due_date`,
				order: sql`issues.due_date`,
				ops: DEFAULT_ORDERED_OPS,
			};
		case "storyPoints":
			return {
				id,
				display,
				type: "numeric",
				nullable: true,
				scalar: sql`issues.story_points`,
				order: sql`issues.story_points`,
				ops: DEFAULT_ORDERED_OPS,
			};
		case "originalEstimate":
		case "remainingEstimate":
		case "timespent": {
			const column =
				id === "originalEstimate"
					? "original_estimate"
					: id === "remainingEstimate"
						? "remaining_estimate"
						: "time_spent";
			return {
				id,
				display,
				type: "numeric",
				nullable: true,
				duration: true,
				scalar: sql`issues.${sql.raw(column)}`,
				order: sql`issues.${sql.raw(column)}`,
				ops: DEFAULT_ORDERED_OPS,
			};
		}
		case "sprint":
			return sprintFieldSpec(id, display, catalog);
		case "hasBranch":
		case "hasOpenMergeRequest":
		case "hasMergedMergeRequest": {
			const expression =
				id === "hasBranch"
					? sql`exists (select 1 from gitlab_branch_issues gbi where gbi.issue_id = issues.id)`
					: id === "hasOpenMergeRequest"
						? sql`exists (select 1 from gitlab_merge_request_issues gmri join gitlab_merge_requests gmr on gmr.id = gmri.merge_request_id where gmri.issue_id = issues.id and gmr.state = 'opened')`
						: sql`exists (select 1 from gitlab_merge_request_issues gmri join gitlab_merge_requests gmr on gmr.id = gmri.merge_request_id where gmri.issue_id = issues.id and gmr.state = 'merged')`;
			return {
				id,
				display,
				type: "text",
				scalar: expression,
				ops: ["=", "!="],
				resolveValue: (literal, at) => {
					const value = literalString(literal)?.trim().toLowerCase();
					if (value === "true") return true;
					if (value === "false") return false;
					throw new JqlError(
						`Expecting true or false for the field '${display}'.`,
						at,
					);
				},
			};
		}
		case "rank":
			return {
				id,
				display,
				type: "text",
				order: sql`issues.rank collate "C"`,
				orderOnly: true,
			};
		case "timeToResolution":
			// The SLA field is not modelled yet. Ordering by it sorts by creation
			// time; replace this expression once SLA cycles are stored.
			return {
				id,
				display,
				type: "timestamp",
				order: sql`issues.created`,
				orderOnly: true,
			};
		case "key":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.key`,
				order: sql`concat((select p.key from projects p where p.id = issues.project_id), '-', lpad(issues.number::text, 12, '0'))`,
				ops: ["=", "!=", "in", "not in"],
			};
		case "id":
			return {
				id,
				display,
				type: "text",
				scalar: sql`issues.source_id`,
				order: NUMERIC_SOURCE_ID,
				ops: DEFAULT_ORDERED_OPS,
			};
		case "parent":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				cast: "uuid",
				scalar: sql`issues.parent_id`,
				order: sql`(select p.key from issues p where p.id = issues.parent_id)`,
			};
		case "epicLink":
			return {
				id,
				display,
				type: "text",
				nullable: true,
				cast: "uuid",
				scalar: sql`issues.epic_id`,
				order: sql`(select e.key from issues e where e.id = issues.epic_id)`,
			};
		case "issueLinkType":
			return {
				id,
				display,
				type: "text",
				cast: "uuid",
				multi: sql`select il.type_id from issue_links il where il.source_issue_id = issues.id or il.target_issue_id = issues.id`,
				order: null,
				ops: ["=", "!=", "in", "not in"],
			};
		default:
			throw new JqlError(
				`Field '${display}' does not exist or you do not have permission to view it.`,
				position,
			);
	}
}

function sprintFieldSpec(
	id: string,
	display: string,
	catalog: JqlCatalog,
): FieldSpec {
	return {
		id,
		display,
		type: "text",
		nullable: true,
		multi: sql`select s.name from issue_sprints isp join sprints s on s.id = isp.sprint_id where isp.issue_id = issues.id`,
		order: sql`(select min(s.name) from issue_sprints isp join sprints s on s.id = isp.sprint_id where isp.issue_id = issues.id)`,
		resolveValue: (literal, at) => {
			const value = literalString(literal) ?? "";
			const sprint = catalog.sprints.find(
				(item) => item.name.toLowerCase() === value.toLowerCase(),
			);
			if (!sprint) throw valueError(display, value, at);
			return sprint.name;
		},
	};
}

function resolveField(
	ref: JqlFieldRef,
	catalog: JqlCatalog,
	agentProjects: string[] | null,
): FieldSpec {
	const display = ref.name;

	if (ref.customId !== null) {
		const sourceId = `customfield_${ref.customId}`;
		const field = catalog.customFields.find(
			(item) => item.sourceId === sourceId,
		);
		if (!field || !isVisibleCustomField(field)) {
			throw new JqlError(
				`Field '${display}' does not exist or you do not have permission to view it.`,
				ref.position,
			);
		}
		return customSpec(field, catalog, ref.position);
	}

	const builtin = builtinFieldId(ref.name);
	if (builtin)
		return builtinSpec(builtin, display, catalog, ref.position, agentProjects);

	const custom = catalog.customFields.find(
		(item) => item.name.toLowerCase() === ref.name.trim().toLowerCase(),
	);
	if (custom && isVisibleCustomField(custom)) {
		return customSpec(custom, catalog, ref.position);
	}

	throw new JqlError(
		`Field '${display}' does not exist or you do not have permission to view it.`,
		ref.position,
	);
}

// --- predicates ------------------------------------------------------------

function likePattern(value: string) {
	return `%${value.replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

function castArray(values: SqlValue[], spec: FieldSpec) {
	const cast = spec.cast === "uuid" ? "uuid[]" : ARRAY_CASTS[spec.type];
	return sql`${param(values)}${sql.raw(`::${cast}`)}`;
}

function castValue(value: SqlValue, spec: FieldSpec) {
	if (spec.cast === "uuid") return sql`${value}::uuid`;
	if (spec.type === "date") return sql`${value}::date`;
	return sql`${value}`;
}

async function coerceLiteral(
	spec: FieldSpec,
	literal: Literal,
	ctx: CompileContext,
	position: JqlPosition,
): Promise<SqlValue> {
	if (spec.resolveValue) return spec.resolveValue(literal, position);

	if (spec.type === "text") {
		const value = literalString(literal);
		if (value === undefined) {
			throw new JqlError("Expecting a text value.", position);
		}
		return value;
	}

	if (spec.type === "numeric") {
		if (literal.kind === "number") return literal.value;
		const text = literalString(literal) ?? "";
		const value = spec.duration ? parseDurationValue(text) : Number(text);
		if (value === null || !Number.isFinite(value)) {
			throw new JqlError(
				`The value '${text}' is not a valid number.`,
				position,
			);
		}
		return value;
	}

	const date = parseDateValue(literal, ctx.now, ctx.timeZone);
	if (!date) {
		const text = literalString(literal) ?? "";
		throw new JqlError(`Date value '${text}' is invalid.`, position);
	}
	if (spec.type === "date") {
		const text = literalString(literal);
		const match = text ? ABSOLUTE_DATE.exec(text.trim()) : null;
		if (match && match[4] === undefined) {
			return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
		}
		return isoDayInZone(date, ctx.timeZone);
	}
	return date;
}

function scalarComparison(
	expression: SQL,
	operator: JqlComparisonOperator,
	values: SqlValue[],
	spec: FieldSpec,
): SQL {
	if (values.length === 0) {
		const positive = operator !== "!=" && operator !== "not in";
		return positive ? sql`false` : sql`true`;
	}
	const [first] = values;

	if (operator === "=") {
		return sql`${expression} = ${castValue(first as SqlValue, spec)}`;
	}
	if (operator === "!=") {
		return sql`${expression} <> ${castValue(first as SqlValue, spec)}`;
	}
	if (operator === "in") {
		return sql`${expression} = any(${castArray(values, spec)})`;
	}
	if (operator === "not in") {
		return sql`${expression} <> all(${castArray(values, spec)})`;
	}
	const keyword = COMPARISON_KEYWORDS[operator];
	if (!keyword) {
		throw new Error(`unsupported scalar operator ${operator}`);
	}
	return sql`${expression} ${sql.raw(keyword)} ${castValue(first as SqlValue, spec)}`;
}

async function compileClause(
	clause: JqlClause,
	ctx: CompileContext,
): Promise<SQL> {
	const spec = resolveField(clause.field, ctx.catalog, ctx.agentProjectIds);
	const display = spec.display;
	const position = clause.operand.position;

	if (spec.orderOnly) {
		throw new JqlError(
			`Field '${display}' can only be used in ORDER BY.`,
			clause.field.position,
		);
	}

	let operator = clause.operator;
	if (operator === "is") operator = "=";
	if (operator === "is not") operator = "!=";

	const isEmpty = clause.operand.kind === "empty";
	if ((operator === "=" || operator === "!=") && isEmpty) {
		return emptyPredicate(spec, operator === "!=");
	}

	if (isEmpty) {
		throw new JqlError(
			`The operator '${operator}' cannot be used with EMPTY.`,
			position,
		);
	}

	if (spec.id === "key" || spec.id === "id") {
		return compileKeyOrId(spec, operator, clause.operand, ctx);
	}
	if (spec.id === "parent" || spec.id === "epicLink") {
		return compileParentClause(spec, operator, clause.operand, ctx);
	}
	if (spec.id === "issueLinkType") {
		return compileLinkTypeClause(spec, operator, clause.operand, ctx);
	}

	const operators =
		spec.ops ??
		(spec.type === "text"
			? spec.contains || spec.multiContains
				? DEFAULT_TEXT_OPS
				: DEFAULT_TEXT_OPS_NO_CONTAINS
			: DEFAULT_ORDERED_OPS);

	if (!operators.includes(operator)) {
		throw new JqlError(
			`The operator '${operator}' is not supported by the field '${display}'.`,
			position,
		);
	}

	if (operator === "~" || operator === "!~") {
		const literals = await operandLiterals(clause.operand, ctx);
		const [literal] = literals;
		const text = literal ? literalString(literal) : undefined;
		if (text === undefined) {
			throw new JqlError("Expecting a text value.", position);
		}
		const pattern = likePattern(text);
		const predicate = spec.contains
			? spec.contains(sql`${text}`, sql`${pattern}`)
			: spec.multiContains
				? spec.multiContains(sql`${pattern}`)
				: null;
		if (!predicate) {
			throw new JqlError(
				`The operator '${operator}' is not supported by the field '${display}'.`,
				position,
			);
		}
		return operator === "~" ? predicate : sql`not (${predicate})`;
	}

	const { literals, empty } = await comparisonLiterals(clause.operand, ctx);
	if (literals.length === 0 && !empty) {
		return sql`false`;
	}

	const positives: SqlValue[] = [];
	const unresolvedValues: string[] = [];
	for (const literal of literals) {
		const text = literalString(literal);
		if (spec.unresolved && text?.toLowerCase() === "unresolved") {
			unresolvedValues.push(text);
			continue;
		}
		positives.push(await coerceLiteral(spec, literal, ctx, position));
	}

	if (
		empty &&
		operator !== "=" &&
		operator !== "in" &&
		operator !== "!=" &&
		operator !== "not in"
	) {
		throw new JqlError(
			`The value 'EMPTY' cannot be used with the operator '${operator}'.`,
			position,
		);
	}

	if (spec.unresolved && (unresolvedValues.length > 0 || empty)) {
		return compileUnresolved(spec, operator, positives);
	}

	if (positives.length === 0) {
		if (empty) {
			return operator === "=" || operator === "in"
				? emptyPredicate(spec, false)
				: emptyPredicate(spec, true);
		}
		return operator === "=" || operator === "in" ? sql`false` : sql`true`;
	}

	if (
		operator === ">" ||
		operator === ">=" ||
		operator === "<" ||
		operator === "<="
	) {
		if (positives.length !== 1) {
			throw new JqlError(
				`The operator '${operator}' requires a single value.`,
				position,
			);
		}
	}

	let predicate: SQL;
	if (spec.columns) {
		predicate = compileColumns(spec, spec.columns, operator, positives);
	} else if (spec.multi) {
		predicate = compileMulti(spec, operator, positives);
	} else if (spec.scalar) {
		predicate = scalarComparison(spec.scalar, operator, positives, spec);
	} else {
		throw new JqlError(
			`Field '${display}' cannot be searched.`,
			clause.field.position,
		);
	}

	// EMPTY in an IN list adds "is null"; in a NOT IN list it is already
	// implied by Jira's negated forms excluding empty values.
	if (empty && (operator === "=" || operator === "in")) {
		return sql`(${predicate} or ${emptyPredicate(spec, false)})`;
	}
	return predicate;
}

function emptyPredicate(spec: FieldSpec, negated: boolean): SQL {
	if (spec.multi) {
		return negated
			? sql`exists (${spec.multi})`
			: sql`not exists (${spec.multi})`;
	}
	if (spec.columns) {
		if (negated) {
			return sql`(${sql.join(
				spec.columns.map((column) => sql`${column} is not null`),
				sql` or `,
			)})`;
		}
		return sql`(${sql.join(
			spec.columns.map((column) => sql`${column} is null`),
			sql` and `,
		)})`;
	}
	if (!spec.scalar) {
		throw new JqlError(`Field '${spec.display}' does not support EMPTY.`);
	}
	return negated
		? sql`${spec.scalar} is not null`
		: sql`${spec.scalar} is null`;
}

function compileColumns(
	spec: FieldSpec,
	columns: SQL[],
	operator: JqlComparisonOperator,
	values: SqlValue[],
): SQL {
	const positive = (operator === "=" || operator === "in") as boolean;
	if (values.length === 0) return positive ? sql`false` : sql`true`;
	const perColumn = columns.map((column) =>
		scalarComparison(
			column,
			positive ? "=" : "!=",
			[values[0] as SqlValue],
			spec,
		),
	);
	// Multiple values are rare for cascading selects; OR them per column.
	if (values.length > 1) {
		const expanded = columns.map((column) =>
			values
				.map((value) =>
					scalarComparison(column, positive ? "=" : "!=", [value], spec),
				)
				.reduce((left, right) =>
					positive ? sql`(${left} or ${right})` : sql`(${left} and ${right})`,
				),
		);
		return positive
			? expanded.reduce((left, right) => sql`(${left} or ${right})`)
			: expanded.reduce((left, right) => sql`(${left} and ${right})`);
	}
	if (positive) {
		return perColumn.reduce((left, right) => sql`(${left} or ${right})`);
	}
	return perColumn.reduce((left, right) => sql`(${left} and ${right})`);
}

function multiMatch(
	subquery: SQL,
	operator: JqlComparisonOperator,
	values: SqlValue[],
	spec: FieldSpec,
): SQL {
	const positive = operator === "=" || operator === "in";
	if (values.length === 0) return positive ? sql`false` : sql`true`;
	const matches = values.map((value) => {
		const expression = castValue(value, spec);
		return sql`${expression} = any(${subquery})`;
	});
	const combined = matches.reduce((left, right) => sql`(${left} or ${right})`);
	// Jira treats an empty multi-valued field as unknown, not as "no match":
	// negated forms must not return issues that have no value at all.
	const match = sql`case when exists (${subquery}) then (${combined}) else null end`;
	return positive ? match : sql`not (${match})`;
}

function compileMulti(
	spec: FieldSpec,
	operator: JqlComparisonOperator,
	values: SqlValue[],
): SQL {
	if (!spec.multi) throw new Error("missing multi expression");
	return multiMatch(spec.multi, operator, values, spec);
}

function compileUnresolved(
	spec: FieldSpec,
	operator: JqlComparisonOperator,
	positives: SqlValue[],
): SQL {
	if (!spec.scalar) throw new Error("missing scalar expression");
	const resolved = spec.scalar;
	const positive = operator === "=" || operator === "in";
	const negated = operator === "!=" || operator === "not in";

	if (!positive && !negated) {
		throw new JqlError(
			`The value 'Unresolved' cannot be used with the operator '${operator}'.`,
		);
	}

	if (positive) {
		if (positives.length === 0) return sql`${resolved} is null`;
		return sql`(${resolved} is null or ${scalarComparison(resolved, "in", positives, spec)})`;
	}

	if (positives.length === 0) return sql`${resolved} is not null`;
	return sql`(${resolved} is not null and ${scalarComparison(resolved, "not in", positives, spec)})`;
}

async function compileKeyOrId(
	spec: FieldSpec,
	operator: JqlComparisonOperator,
	operand: JqlOperand,
	ctx: CompileContext,
): Promise<SQL> {
	const literals = await operandLiterals(operand, ctx);
	const texts = literals.map((literal) => literalString(literal) ?? "");

	if (spec.id === "id") {
		if (
			operator === "=" ||
			operator === "!=" ||
			operator === "in" ||
			operator === "not in"
		) {
			const column = sql`issues.source_id`;
			return scalarComparison(column, operator, texts, {
				...spec,
				type: "text",
				nullable: false,
			});
		}
		const numbers = texts.map((text) => Number(text));
		if (numbers.some((value) => !Number.isFinite(value))) {
			throw new JqlError(
				"The value is not a valid issue id.",
				operand.position,
			);
		}
		return scalarComparison(NUMERIC_SOURCE_ID, operator, numbers, {
			...spec,
			type: "numeric",
			nullable: false,
		});
	}

	if (
		operator === "=" ||
		operator === "!=" ||
		operator === "in" ||
		operator === "not in"
	) {
		if (texts.length === 0) {
			return operator === "=" || operator === "in" ? sql`false` : sql`true`;
		}
		const matches = texts.map(
			(text) => sql`lower(issues.key) = lower(${text})`,
		);
		const combined = matches.reduce(
			(left, right) => sql`(${left} or ${right})`,
		);
		return operator === "=" || operator === "in"
			? combined
			: sql`not (${combined})`;
	}

	const keyword = COMPARISON_KEYWORDS[operator];
	if (!keyword) {
		throw new JqlError(
			`The operator '${operator}' is not supported by the field '${spec.display}'.`,
			operand.position,
		);
	}
	const conditions: SQL[] = [];
	for (const text of texts) {
		const match = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(text);
		if (!match) {
			throw new JqlError(
				`The value '${text}' is not a valid issue key.`,
				operand.position,
			);
		}
		const project = findProject(ctx.catalog, match[1] as string);
		if (!project) {
			throw valueError(spec.display, text, operand.position);
		}
		conditions.push(
			sql`(issues.project_id = ${project.id} and issues.number ${sql.raw(keyword)} ${Number(match[2])})`,
		);
	}
	return conditions.reduce((left, right) => sql`(${left} or ${right})`);
}

async function issueIdForKey(
	key: string,
	position: JqlPosition,
	display: string,
	ctx: CompileContext,
) {
	const visible = visibleProjectCondition(ctx);
	const result = await db.execute(
		sql`select id from issues where lower(key) = lower(${key})${visible ? sql` and ${visible}` : sql``} limit 1`,
	);
	const row = (result.rows as { id: string }[])[0];
	if (!row) throw valueError(display, key, position);
	return row.id;
}

async function compileParentClause(
	spec: FieldSpec,
	operator: JqlComparisonOperator,
	operand: JqlOperand,
	ctx: CompileContext,
): Promise<SQL> {
	if (operand.kind === "empty") {
		return emptyPredicate(spec, operator === "!=");
	}
	if (operator === "~" || operator === "!~") {
		throw new JqlError(
			`The operator '${operator}' is not supported by the field '${spec.display}'.`,
			operand.position,
		);
	}
	const literals = await operandLiterals(operand, ctx);
	const ids: string[] = [];
	for (const literal of literals) {
		ids.push(
			await issueIdForKey(
				literalString(literal) ?? "",
				operand.position,
				spec.display,
				ctx,
			),
		);
	}
	const column =
		spec.id === "parent" ? sql`issues.parent_id` : sql`issues.epic_id`;
	if (
		spec.id === "parent" &&
		(operator === "=" ||
			operator === "in" ||
			operator === "!=" ||
			operator === "not in")
	) {
		const match = sql`coalesce(${column} = any(${castArray(ids, spec)}), false)`;
		return operator === "=" || operator === "in" ? match : sql`not (${match})`;
	}
	return scalarComparison(column, operator, ids, { ...spec, nullable: true });
}

async function compileLinkTypeClause(
	spec: FieldSpec,
	operator: JqlComparisonOperator,
	operand: JqlOperand,
	ctx: CompileContext,
): Promise<SQL> {
	if (operand.kind === "empty") {
		return emptyPredicate(spec, operator === "!=");
	}
	const literals = await operandLiterals(operand, ctx);
	const ids: string[] = [];
	for (const literal of literals) {
		const value = literalString(literal) ?? "";
		const type = findLinkType(ctx.catalog, value);
		if (!type) throw valueError(spec.display, value, operand.position);
		ids.push(type.id);
	}

	const positive = operator === "=" || operator === "in";
	if (!positive && operator !== "!=" && operator !== "not in") {
		throw new JqlError(
			`The operator '${operator}' is not supported by the field '${spec.display}'.`,
			operand.position,
		);
	}

	const predicate = sql`exists (
		select 1 from issue_links il
		where (il.source_issue_id = issues.id or il.target_issue_id = issues.id)
			and il.type_id = any(${param(ids)}::uuid[])
	)`;
	return positive ? predicate : sql`not (${predicate})`;
}

// --- history ---------------------------------------------------------------

interface HistoryField {
	field: string;
	current: SQL;
	resolve: (literal: Literal, position: JqlPosition) => string | null;
}

function historyField(
	spec: FieldSpec,
	ctx: CompileContext,
	position: JqlPosition,
): HistoryField {
	const display = spec.display;
	const requireStatus = (value: string) => {
		const status = findStatus(ctx.catalog, value);
		if (!status) throw valueError(display, value, position);
		return status.name;
	};
	const requirePriority = (value: string) => {
		const priority = ctx.catalog.priorities.find(
			(item) => item.name.toLowerCase() === value.toLowerCase(),
		);
		if (!priority) throw valueError(display, value, position);
		return priority.name;
	};
	const requireResolution = (value: string) => {
		if (value.toLowerCase() === "unresolved") return null;
		const resolution = ctx.catalog.resolutions.find(
			(item) => item.name.toLowerCase() === value.toLowerCase(),
		);
		if (!resolution) throw valueError(display, value, position);
		return resolution.name;
	};
	const requireUser = (value: string) => {
		const user = findUser(ctx.catalog, value);
		if (!user) throw valueError(display, value, position);
		return user.displayName;
	};
	const requireVersion = (value: string) => {
		const version = ctx.catalog.versions.find(
			(item) => item.name.toLowerCase() === value.toLowerCase(),
		);
		if (!version) throw valueError(display, value, position);
		return version.name;
	};

	switch (spec.id) {
		case "status":
			return {
				field: "status",
				current: sql`(select s.name from statuses s where s.id = issues.status_id)`,
				resolve: (literal) => requireStatus(literalString(literal) ?? ""),
			};
		case "priority":
			return {
				field: "priority",
				current: sql`(select p.name from priorities p where p.id = issues.priority_id)`,
				resolve: (literal) => requirePriority(literalString(literal) ?? ""),
			};
		case "resolution":
			return {
				field: "resolution",
				current: sql`(select r.name from resolutions r where r.id = issues.resolution_id)`,
				resolve: (literal) => requireResolution(literalString(literal) ?? ""),
			};
		case "assignee":
			return {
				field: "assignee",
				current: sql`(select u.display_name from users u where u.id = issues.assignee_id)`,
				resolve: (literal) => requireUser(literalString(literal) ?? ""),
			};
		case "reporter":
			return {
				field: "reporter",
				current: sql`(select u.display_name from users u where u.id = issues.reporter_id)`,
				resolve: (literal) => requireUser(literalString(literal) ?? ""),
			};
		case "fixVersion":
			return {
				field: "Fix Version",
				current: sql`(select min(v.name) from issue_fix_versions fv join versions v on v.id = fv.version_id where fv.issue_id = issues.id)`,
				resolve: (literal) => requireVersion(literalString(literal) ?? ""),
			};
		default:
			throw new JqlError(
				`Field '${display}' does not support history searches.`,
				position,
			);
	}
}

function historyValueMatch(
	column: "from_string" | "to_string",
	values: (string | null)[],
): SQL {
	const conditions = values.map((value) =>
		value === null
			? sql`(hi.${sql.raw(column)} is null or btrim(hi.${sql.raw(column)}) = '')`
			: sql`lower(hi.${sql.raw(column)}) = lower(${value})`,
	);
	return conditions.reduce((left, right) => sql`(${left} or ${right})`);
}

async function compileHistory(
	clause: JqlHistoryClause,
	ctx: CompileContext,
): Promise<SQL> {
	const spec = resolveField(clause.field, ctx.catalog, ctx.agentProjectIds);
	const history = historyField(spec, ctx, clause.field.position);

	const conditions: SQL[] = [
		sql`h.issue_id = issues.id`,
		sql`lower(hi.field) = lower(${history.field})`,
	];

	const valueLiterals: Literal[] = [];
	for (const value of clause.values) {
		valueLiterals.push(await singleLiteral(value, ctx));
	}
	const values = valueLiterals.map((literal) =>
		history.resolve(
			literal,
			clause.values[0]?.position ?? clause.field.position,
		),
	);

	if (values.length > 0) {
		const fromMatch = historyValueMatch("from_string", values);
		const toMatch = historyValueMatch("to_string", values);
		conditions.push(sql`(${fromMatch} or ${toMatch})`);
	}

	if (clause.from) {
		const literal = await singleLiteral(clause.from, ctx);
		const value = history.resolve(literal, clause.from.position);
		conditions.push(
			value === null
				? sql`(hi.from_string is null or btrim(hi.from_string) = '')`
				: sql`lower(hi.from_string) = lower(${value})`,
		);
	}
	if (clause.to) {
		const literal = await singleLiteral(clause.to, ctx);
		const value = history.resolve(literal, clause.to.position);
		conditions.push(
			value === null
				? sql`(hi.to_string is null or btrim(hi.to_string) = '')`
				: sql`lower(hi.to_string) = lower(${value})`,
		);
	}
	if (clause.by) {
		const literal = await singleLiteral(clause.by, ctx);
		const value = literalString(literal) ?? "";
		const user = findUser(ctx.catalog, value);
		if (!user) throw valueError(spec.display, value, clause.by.position);
		conditions.push(sql`h.author_id = ${user.id}`);
	}

	const timestamp = async (operand: JqlOperand) => {
		const literal = await singleLiteral(operand, ctx);
		const value = parseDateValue(literal, ctx.now, ctx.timeZone);
		if (!value) {
			throw new JqlError(
				`Date value '${literalString(literal) ?? ""}' is invalid.`,
				operand.position,
			);
		}
		return value;
	};

	if (clause.after) {
		conditions.push(sql`h.created > ${await timestamp(clause.after)}`);
	}
	if (clause.before) {
		conditions.push(sql`h.created < ${await timestamp(clause.before)}`);
	}
	if (clause.on) {
		const value = await timestamp(clause.on);
		const start = startOfDay(value, 0, ctx.timeZone);
		const end = startOfDay(value, 1, ctx.timeZone);
		conditions.push(sql`h.created >= ${start} and h.created < ${end}`);
	}
	if (clause.during) {
		const [fromOperand, toOperand] = clause.during;
		const from = await timestamp(fromOperand);
		const to = await timestamp(toOperand);
		conditions.push(sql`h.created >= ${from} and h.created <= ${to}`);
	}

	const exists = sql`exists (
		select 1 from issue_history h
		join issue_history_items hi on hi.history_id = h.id
		where ${sql.join(conditions, sql` and `)}
	)`;

	if (clause.operator === "changed") return exists;

	if (values.length === 0) return exists;

	const currentMatch = values
		.map((value) =>
			value === null
				? sql`${history.current} is null`
				: sql`lower(${history.current}) = lower(${value})`,
		)
		.reduce((left, right) => sql`(${left} or ${right})`);
	// Jira's history forms are two-valued: "was not" also returns issues whose
	// current value is empty.
	const current = sql`coalesce(${currentMatch}, false)`;

	const was = clause.operator === "was" || clause.operator === "was in";
	if (was) return sql`(${exists} or ${current})`;
	return sql`not (${exists} or ${current})`;
}

// --- order by --------------------------------------------------------------

function orderExpression(item: JqlOrderBy, ctx: CompileContext): SQL {
	const spec = resolveField(item.field, ctx.catalog, ctx.agentProjectIds);
	if (spec.order === null || spec.order === undefined) {
		throw new JqlError(
			`Field '${spec.display}' cannot be sorted on.`,
			item.field.position,
		);
	}
	const direction = item.direction === "desc" ? "desc" : "asc";
	return sql`${spec.order} ${sql.raw(direction)} nulls last`;
}

// --- entry point -----------------------------------------------------------

async function compileNode(node: JqlNode, ctx: CompileContext): Promise<SQL> {
	if (node.kind === "and") {
		return sql`(${await compileNode(node.left, ctx)} and ${await compileNode(node.right, ctx)})`;
	}
	if (node.kind === "or") {
		return sql`(${await compileNode(node.left, ctx)} or ${await compileNode(node.right, ctx)})`;
	}
	if (node.kind === "not") {
		return sql`not (${await compileNode(node.operand, ctx)})`;
	}
	if (node.kind === "history") {
		return compileHistory(node, ctx);
	}
	return compileClause(node, ctx);
}

export async function compileJql(
	query: JqlQuery,
	options: CompileOptions,
): Promise<CompiledJql> {
	const ctx: CompileContext = {
		catalog: options.catalog ?? (await loadCatalog()),
		user: options.user,
		now: options.now ?? new Date(),
		timeZone: options.timeZone ?? dateContext().timeZone,
		visibleProjectIds: options.visibleProjectIds,
		agentProjectIds: options.user ? await agentProjectIds(options.user) : null,
	};

	const nodeWhere = query.where ? await compileNode(query.where, ctx) : null;
	const visible = visibleProjectCondition(ctx);
	const where = visible
		? nodeWhere
			? sql`(${nodeWhere}) and ${visible}`
			: visible
		: nodeWhere;

	const orderBy: SQL[] = query.orderBy.map((item) =>
		orderExpression(item, ctx),
	);
	orderBy.push(sql`issues.created desc nulls last`, sql`issues.id asc`);

	return { where, orderBy };
}
