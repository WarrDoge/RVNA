import { describe, expect, test } from "vitest";
import {
	BASIC_NONE,
	type BasicQuery,
	basicToJql,
	emptyBasicQuery,
	jqlToBasic,
	parseJql,
	quoteJqlValue,
} from "../src/lib/shared/jql/index.ts";

function roundTrip(query: BasicQuery, orderBy: string[] = []) {
	const jql = basicToJql(
		query,
		orderBy.map((item) => ({
			field: {
				name: item.split(" ")[0] as string,
				customId: null,
				position: { line: 1, character: 1 },
			},
			direction: (item.split(" ")[1] as "asc" | "desc") ?? "asc",
		})),
	);
	const parsed = jqlToBasic(parseJql(jql));
	if (!parsed.ok) throw new Error(parsed.error);
	return { jql, query: parsed.query };
}

describe("basic mode to JQL", () => {
	test("an empty query orders by updated", () => {
		expect(basicToJql(emptyBasicQuery())).toBe("ORDER BY updated DESC");
	});

	test("every picker becomes a clause joined with AND", () => {
		const query: BasicQuery = {
			...emptyBasicQuery(),
			project: ["DEMO"],
			type: ["Task"],
			status: ["To Do"],
			assignee: ["currentUser()"],
			text: "payload",
			priority: ["High"],
			labels: ["alpha"],
		};
		expect(basicToJql(query)).toBe(
			'project = DEMO AND issuetype = Task AND status = "To Do" AND assignee = currentUser() AND priority = High AND labels = alpha AND text ~ payload ORDER BY updated DESC',
		);
	});

	test("a list of values becomes IN", () => {
		const query = { ...emptyBasicQuery(), status: ["To Do", "Done"] };
		expect(basicToJql(query)).toContain('status in ("To Do", Done)');
	});

	test("the empty sentinel becomes IS EMPTY", () => {
		const query = { ...emptyBasicQuery(), assignee: [BASIC_NONE] };
		expect(basicToJql(query)).toBe("assignee is EMPTY ORDER BY updated DESC");
	});

	test("date ranges become bounds", () => {
		const query = {
			...emptyBasicQuery(),
			created: { from: "2026-01-01", to: "2026-01-31" },
			updated: { from: "-7d", to: "" },
		};
		expect(basicToJql(query)).toBe(
			"created >= 2026-01-01 AND created <= 2026-01-31 AND updated >= -7d ORDER BY updated DESC",
		);
	});

	test("an order by is carried over", () => {
		const jql = basicToJql({ ...emptyBasicQuery(), project: ["DEMO"] }, [
			{
				field: {
					name: "created",
					customId: null,
					position: { line: 1, character: 1 },
				},
				direction: "desc",
			},
		]);
		expect(jql).toBe("project = DEMO ORDER BY created DESC");
	});

	test("values are quoted when they are not plain words", () => {
		expect(quoteJqlValue("plain")).toBe("plain");
		expect(quoteJqlValue("has space")).toBe('"has space"');
		expect(quoteJqlValue('say "hi"')).toBe('"say \\"hi\\""');
		expect(quoteJqlValue("and")).toBe('"and"');
		expect(quoteJqlValue("123")).toBe('"123"');
		expect(quoteJqlValue("DEMO-1")).toBe("DEMO-1");
	});
});

describe("JQL to basic mode", () => {
	test("clauses come back as pickers", () => {
		const parsed = jqlToBasic(
			parseJql(
				'project = DEMO AND issuetype in (Task, Bug) AND status = "In Progress" AND labels = alpha AND text ~ payload ORDER BY created ASC',
			),
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.query.project).toEqual(["DEMO"]);
		expect(parsed.query.type).toEqual(["Task", "Bug"]);
		expect(parsed.query.status).toEqual(["In Progress"]);
		expect(parsed.query.labels).toEqual(["alpha"]);
		expect(parsed.query.text).toBe("payload");
		expect(parsed.orderBy[0]?.direction).toBe("asc");
	});

	test("IS EMPTY becomes the empty sentinel", () => {
		const parsed = jqlToBasic(parseJql("assignee is EMPTY"));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.query.assignee).toEqual([BASIC_NONE]);
	});

	test("date bounds come back", () => {
		const parsed = jqlToBasic(
			parseJql("created >= -7d AND updated <= 2026-02-01"),
		);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.query.created).toEqual({ from: "-7d", to: "" });
		expect(parsed.query.updated).toEqual({ from: "", to: "2026-02-01" });
	});

	test("a query round trips", () => {
		const query: BasicQuery = {
			...emptyBasicQuery(),
			project: ["DEMO"],
			type: ["Bug"],
			status: ["To Do", "In Progress"],
			assignee: ["currentUser()"],
			text: "calibration",
			priority: ["High"],
			reporter: ["jdoe"],
			labels: ["alpha", "beta"],
			resolution: ["Unresolved"],
			fixVersion: ["1.0"],
			component: ["flight"],
			epic: ["DEMO-1"],
			created: { from: "2026-01-01", to: "" },
			updated: { from: "", to: "2026-02-01" },
		};
		const result = roundTrip(query, ["created desc"]);
		expect(result.query).toEqual(query);
	});
});

describe("queries basic mode cannot show", () => {
	const cases: [string, RegExp][] = [
		["project = DEMO OR project = OTHER", /OR/],
		["NOT project = DEMO", /NOT/],
		["status was Done", /history/],
		["status changed", /history/],
		["status != Done", /operator/],
		["summary ~ payload", /not available/],
		["description ~ payload", /not available/],
		["cf[10010] = value", /custom field/],
		["created = 2026-01-01", /cannot show/],
		["text = payload", /contains/],
		["assignee is not EMPTY", /operator/],
		['project = DEMO AND (status = Done OR status = "To Do")', /OR/],
	];

	for (const [jql, message] of cases) {
		test(jql, () => {
			const parsed = jqlToBasic(parseJql(jql));
			expect(parsed.ok).toBe(false);
			if (parsed.ok) return;
			expect(parsed.error).toMatch(message);
		});
	}
});
