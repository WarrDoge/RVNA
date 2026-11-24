import { describe, expect, test } from "vitest";
import { customFieldJql } from "../src/lib/shared/fields.ts";
import {
	JqlError,
	type JqlNode,
	type JqlOperand,
	parseJql,
} from "../src/lib/shared/jql/index.ts";

function operand(value: JqlOperand): string {
	switch (value.kind) {
		case "string":
			return value.quoted ? `"${value.value}"` : value.value;
		case "number":
			return value.text;
		case "empty":
			return "EMPTY";
		case "list":
			return `[${value.values.map(operand).join(", ")}]`;
		case "function":
			return `${value.name}(${value.args.map(operand).join(", ")})`;
	}
}

function node(value: JqlNode): string {
	switch (value.kind) {
		case "and":
			return `(${node(value.left)} AND ${node(value.right)})`;
		case "or":
			return `(${node(value.left)} OR ${node(value.right)})`;
		case "not":
			return `NOT ${node(value.operand)}`;
		case "clause":
			return `${value.field.name} ${value.operator} ${operand(value.operand)}`;
		case "history": {
			const parts = [`${value.field.name} ${value.operator.toUpperCase()}`];
			if (value.values.length > 0) {
				parts.push(value.values.map(operand).join(", "));
			}
			if (value.from) parts.push(`FROM ${operand(value.from)}`);
			if (value.to) parts.push(`TO ${operand(value.to)}`);
			if (value.by) parts.push(`BY ${operand(value.by)}`);
			if (value.after) parts.push(`AFTER ${operand(value.after)}`);
			if (value.before) parts.push(`BEFORE ${operand(value.before)}`);
			if (value.on) parts.push(`ON ${operand(value.on)}`);
			if (value.during) {
				parts.push(
					`DURING (${operand(value.during[0])}, ${operand(value.during[1])})`,
				);
			}
			return parts.join(" ").trim();
		}
	}
}

function summarize(jql: string) {
	const query = parseJql(jql);
	const where = query.where ? node(query.where) : "";
	const order = query.orderBy
		.map((item) => `${item.field.name} ${item.direction.toUpperCase()}`)
		.join(", ");
	return order ? `${where} ORDER BY ${order}`.trim() : where;
}

function positionOf(input: string, needle: string, occurrence = 0) {
	if (needle === "end of input") {
		const lines = input.split("\n");
		return {
			line: lines.length,
			character: (lines[lines.length - 1] as string).length + 1,
		};
	}
	let index = -1;
	for (let step = 0; step <= occurrence; step++) {
		index = input.indexOf(needle, index + 1);
	}
	if (index < 0) throw new Error(`needle ${needle} not found in ${input}`);
	const before = input.slice(0, index).split("\n");
	return {
		line: before.length,
		character: (before[before.length - 1] as string).length + 1,
	};
}

type ValidCase = [string, string];

const validCases: ValidCase[] = [
	["", ""],
	["project = DEMO", "project = DEMO"],
	['project = "DEMO"', 'project = "DEMO"'],
	['project = "WEB"', 'project = "WEB"'],
	[
		'project = "WEB" ORDER BY created DESC',
		'project = "WEB" ORDER BY created DESC',
	],
	["project = DEMO AND status = Open", "(project = DEMO AND status = Open)"],
	["project = DEMO OR status = Open", "(project = DEMO OR status = Open)"],
	[
		"project = DEMO AND status = Open OR priority = High",
		"((project = DEMO AND status = Open) OR priority = High)",
	],
	[
		"project = DEMO OR status = Open AND priority = High",
		"(project = DEMO OR (status = Open AND priority = High))",
	],
	["NOT project = DEMO", "NOT project = DEMO"],
	["! project = DEMO", "NOT project = DEMO"],
	["NOT NOT project = DEMO", "NOT NOT project = DEMO"],
	[
		"NOT (project = DEMO OR status = Open)",
		"NOT (project = DEMO OR status = Open)",
	],
	[
		"(project = DEMO OR status = Open) AND priority = High",
		"((project = DEMO OR status = Open) AND priority = High)",
	],
	['project in (DEMO, "WEB")', 'project in [DEMO, "WEB"]'],
	['project in ("WEB", "OPS")', 'project in ["WEB", "OPS"]'],
	["project not in (DEMO)", "project not in [DEMO]"],
	[
		'status in ("In Progress", Escalated, Open)',
		'status in ["In Progress", Escalated, Open]',
	],
	["summary ~ widget", "summary ~ widget"],
	['summary = "OR"', 'summary = "OR"'],
	["summary !~ widget", "summary !~ widget"],
	['summary = "hello world"', 'summary = "hello world"'],
	['summary = "say \\"hi\\""', 'summary = "say "hi""'],
	['summary = "back\\\\slash"', 'summary = "back\\slash"'],
	["labels is EMPTY", "labels is EMPTY"],
	["labels is not EMPTY", "labels is not EMPTY"],
	["labels = EMPTY", "labels = EMPTY"],
	["assignee != EMPTY", "assignee != EMPTY"],
	["created >= -7d", "created >= -7d"],
	['created >= "2026/11/01"', 'created >= "2026/11/01"'],
	['created >= "2026-11-01 14:00"', 'created >= "2026-11-01 14:00"'],
	["due <= 24h", "due <= 24h"],
	['originalEstimate >= "2h 30m"', 'originalEstimate >= "2h 30m"'],
	['"Story Points" > 3', "Story Points > 3"],
	["cf[10106] = foo", "cf[10106] = foo"],
	["cf[10106] in (a, b)", "cf[10106] in [a, b]"],
	["assignee = currentUser()", "assignee = currentuser()"],
	["updated >= startOfMonth(-1)", "updated >= startofmonth(-1)"],
	["created >= startOfDay()", "created >= startofday()"],
	["created < endOfWeek(2)", "created < endofweek(2)"],
	[
		'assignee in membersOf("rvna-admins")',
		'assignee in [membersof("rvna-admins")]',
	],
	["issuetype in subTaskIssueTypes()", "issuetype in [subtaskissuetypes()]"],
	["issuetype in standardIssueTypes()", "issuetype in [standardissuetypes()]"],
	["sprint in openSprints()", "sprint in [opensprints()]"],
	["sprint in closedSprints()", "sprint in [closedsprints()]"],
	["sprint in futureSprints()", "sprint in [futuresprints()]"],
	["issue in linkedIssues(DEMO-1)", "issue in [linkedissues(DEMO-1)]"],
	[
		'issue in linkedIssues(DEMO-1, "is blocked by")',
		'issue in [linkedissues(DEMO-1, "is blocked by")]',
	],
	["fixVersion in releasedVersions()", "fixVersion in [releasedversions()]"],
	[
		"fixVersion in unreleasedVersions()",
		"fixVersion in [unreleasedversions()]",
	],
	["issuekey in updatedBy(alice)", "issuekey in [updatedby(alice)]"],
	[
		"issuekey in updatedBy(alice, -7d, now())",
		"issuekey in [updatedby(alice, -7d, now())]",
	],
	['status was "In Progress"', 'status WAS "In Progress"'],
	['status was not "In Progress"', 'status WAS NOT "In Progress"'],
	['status was in (Open, "In Progress")', 'status WAS IN Open, "In Progress"'],
	["status was not in (Open, Done)", "status WAS NOT IN Open, Done"],
	["status changed", "status CHANGED"],
	["status changed from Open", "status CHANGED FROM Open"],
	["status changed to Done", "status CHANGED TO Done"],
	[
		"status changed by alice after -30d before now()",
		"status CHANGED BY alice AFTER -30d BEFORE now()",
	],
	["status changed during (-7d, now())", "status CHANGED DURING (-7d, now())"],
	['status changed on "2026-11-01"', 'status CHANGED ON "2026-11-01"'],
	["assignee changed from alice to bob", "assignee CHANGED FROM alice TO bob"],
	["priority was Highest", "priority WAS Highest"],
	["resolution was Unresolved", "resolution WAS Unresolved"],
	['fixVersion was "Version 1.0"', 'fixVersion WAS "Version 1.0"'],
	["reporter was alice", "reporter WAS alice"],
	["project = DEMO ORDER BY Rank ASC", "project = DEMO ORDER BY Rank ASC"],
	["ORDER BY Rank ASC", "ORDER BY Rank ASC"],
	["ORDER BY created DESC, updated ASC", "ORDER BY created DESC, updated ASC"],
	['ORDER BY "Story Points" desc', "ORDER BY Story Points DESC"],
	["project = DEMO order by key", "project = DEMO ORDER BY key ASC"],
	[
		'text ~ "ROS2" AND updated >= startOfMonth(-1)',
		'(text ~ "ROS2" AND updated >= startofmonth(-1))',
	],
	[
		"(labels = a or labels = b) and not (labels = c)",
		"((labels = a OR labels = b) AND NOT labels = c)",
	],
	['summary ~ "multi word phrase"', 'summary ~ "multi word phrase"'],
	["labels in (a, b, c)", "labels in [a, b, c]"],
	["watcher = alice", "watcher = alice"],
	['status = "Waiting for support"', 'status = "Waiting for support"'],
	[
		'project = OPS AND resolution = Unresolved ORDER BY "Time to resolution" ASC',
		"(project = OPS AND resolution = Unresolved) ORDER BY Time to resolution ASC",
	],
	["cf[99002] >= 10", "cf[99002] >= 10"],
	['comment ~ "foo"', 'comment ~ "foo"'],
	['description !~ "foo"', 'description !~ "foo"'],
	['"Epic Link" is not EMPTY', "Epic Link is not EMPTY"],
	['timeSpent > "1h"', 'timeSpent > "1h"'],
	["summary = 42", "summary = 42"],
	['cf[10106] = "two words"', 'cf[10106] = "two words"'],
	[
		"project = DEMO AND (status = Open OR status = Reopened)",
		"(project = DEMO AND (status = Open OR status = Reopened))",
	],
	[
		"due >= startOfYear(-1) AND due < endOfYear(0)",
		"(due >= startofyear(-1) AND due < endofyear(0))",
	],
	["key >= DEMO-10", "key >= DEMO-10"],
	["id = 12800", "id = 12800"],
	["parent = DEMO-1", "parent = DEMO-1"],
	['issueLinkType = "is blocked by"', 'issueLinkType = "is blocked by"'],
	["summary is not null", "summary is not EMPTY"],
	["summary = NULL", "summary = EMPTY"],
];

type ErrorCase = [string, string, string];

const errorCases: ErrorCase[] = [
	["project", "Expecting operator but got 'end of input'.", "end of input"],
	["project = ", "Expecting a value but got 'end of input'.", "end of input"],
	["project = OR", "Expecting a value but got 'OR'.", "OR"],
	["project = AND", "Expecting a value but got 'AND'.", "AND"],
	["AND project = DEMO", "Expecting a field name but got 'AND'.", "AND"],
	[
		"project = DEMO AND",
		"Expecting a field name but got 'end of input'.",
		"end of input",
	],
	["project = DEMO foo", "Expecting end of query but got 'foo'.", "foo"],
	["project in (DEMO,)", "Expecting a value but got ')'.", ")"],
	["project in ()", "Expecting a value but got ')'.", ")"],
	["project in (DEMO, OR", "Expecting a value but got 'OR'.", "OR"],
	["(project = DEMO", "Expecting ')' but got 'end of input'.", "end of input"],
	["project = DEMO)", "Expecting end of query but got ')'.", ")"],
	["status is Open", "Expecting 'EMPTY' or 'NULL' but got 'Open'.", "Open"],
	["cf[] = 1", "Expecting a custom field id but got ']'.", "]"],
	["cf[abc] = 1", "Expecting a custom field id but got 'abc'.", "abc"],
	["foo(1) = 2", "Expecting operator but got '('.", "("],
	[
		"assignee = nosuchfunction()",
		"Function 'nosuchfunction' does not exist.",
		"nosuchfunction",
	],
	[
		"assignee = currentUser(1)",
		"Function 'currentUser' does not accept 1 argument.",
		"(",
	],
	['summary = "unterminated', "Expecting '\"' but got end of input.", '"'],
	[
		"project = DEMO ORDER BY",
		"Expecting a field name but got 'end of input'.",
		"end of input",
	],
	[
		"project = DEMO ORDER",
		"Expecting 'BY' after 'ORDER' but got 'end of input'.",
		"end of input",
	],
	[
		"status changed project = DEMO",
		"Expecting end of query but got 'project'.",
		"project",
	],
	["status changed during (-1d)", "Expecting ',' but got ')'.", ")"],
	["labels = (a, b)", "Expecting a value but got '('.", "("],
	[
		"project = DEMO AND OR status = Open",
		"Expecting a field name but got 'OR'.",
		"OR",
	],
	[
		"project = DEMO AND status = Open OR",
		"Expecting a field name but got 'end of input'.",
		"end of input",
	],
	[
		"project = DEMO AND status",
		"Expecting operator but got 'end of input'.",
		"end of input",
	],
	["NOT", "Expecting a field name but got 'end of input'.", "end of input"],
];

describe("JQL parser", () => {
	test.each(validCases)("parses %j", (jql, expected) => {
		expect(summarize(jql)).toBe(expected);
	});

	test.each(errorCases)(
		"rejects %j",
		(jql, message, needle, occurrence = 0) => {
			try {
				parseJql(jql);
				throw new Error(`expected ${jql} to fail`);
			} catch (error) {
				expect(error).toBeInstanceOf(JqlError);
				const jqlError = error as JqlError;
				expect(jqlError.message).toBe(message);
				const position = positionOf(jql, needle, occurrence);
				expect(jqlError.line).toBe(position.line);
				expect(jqlError.character).toBe(position.character);
				expect(jqlError.jiraMessage).toBe(
					`Error in the JQL Query: ${message} (line ${position.line}, character ${position.character})`,
				);
			}
		},
	);

	test("keeps the full AST for a nested query", () => {
		expect(
			parseJql('project = DEMO AND NOT (summary ~ "x" OR labels in (a, b))'),
		).toEqual({
			where: {
				kind: "and",
				left: {
					kind: "clause",
					field: {
						name: "project",
						customId: null,
						position: { line: 1, character: 1 },
					},
					operator: "=",
					operand: {
						kind: "string",
						value: "DEMO",
						quoted: false,
						position: { line: 1, character: 11 },
					},
				},
				right: {
					kind: "not",
					operand: {
						kind: "or",
						left: {
							kind: "clause",
							field: {
								name: "summary",
								customId: null,
								position: { line: 1, character: 25 },
							},
							operator: "~",
							operand: {
								kind: "string",
								value: "x",
								quoted: true,
								position: { line: 1, character: 35 },
							},
						},
						right: {
							kind: "clause",
							field: {
								name: "labels",
								customId: null,
								position: { line: 1, character: 42 },
							},
							operator: "in",
							operand: {
								kind: "list",
								values: [
									{
										kind: "string",
										value: "a",
										quoted: false,
										position: { line: 1, character: 53 },
									},
									{
										kind: "string",
										value: "b",
										quoted: false,
										position: { line: 1, character: 56 },
									},
								],
								position: { line: 1, character: 52 },
							},
						},
					},
				},
			},
			orderBy: [],
		});
	});

	test("tracks line and character across lines", () => {
		try {
			parseJql("project = DEMO\nAND status = ");
			throw new Error("expected failure");
		} catch (error) {
			expect((error as JqlError).jiraMessage).toBe(
				"Error in the JQL Query: Expecting a value but got 'end of input'. (line 2, character 14)",
			);
		}
	});
});

describe("custom field names in JQL", () => {
	test.each([
		["ends in a backslash", "Path\\"],
		["holds a quote", 'Say "hi"'],
		["ends in a backslash after a quote", 'Mixed "\\'],
		["holds a plain backslash", "A\\B"],
	])("a field name that %s round-trips as one field", (_label, name) => {
		const query = parseJql(
			`${customFieldJql("local:abc", name)} ASC`.replace(/^/, "ORDER BY "),
		);
		expect(query.where).toBeNull();
		expect(query.orderBy.map((item) => item.field.name)).toEqual([name]);

		const filtered = parseJql(
			`${customFieldJql("local:abc", name)} = "x" AND project = DEMO`,
		);
		expect(filtered.where?.kind).toBe("and");
	});
});
