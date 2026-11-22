import { describe, expect, test } from "vitest";
import {
	branchNameFor,
	extractIssueKeys,
	summarySlug,
} from "../src/lib/server/gitlab/keys.ts";
import {
	parseSmartCommitMessage,
	parseTimeSpent,
} from "../src/lib/server/gitlab/smart-commits.ts";

const projects = ["DEMO", "WEB", "DEMO-2"];

describe("issue key extraction", () => {
	test("finds keys in branch names, commit titles and URLs", () => {
		expect(extractIssueKeys("DEMO-343 fix login", projects)).toEqual([
			"DEMO-343",
		]);
		expect(extractIssueKeys("feature/demo-343-fix-login", projects)).toEqual([
			"DEMO-343",
		]);
		expect(
			extractIssueKeys(
				"https://gitlab.example.test/team/service/-/merge_requests/7",
				projects,
			),
		).toEqual([]);
		expect(
			extractIssueKeys(
				"see https://gitlab.example.test/team/service/-/tree/DEMO-9-thing",
				projects,
			),
		).toEqual(["DEMO-9"]);
		expect(
			extractIssueKeys("DEMO-2 and WEB-7, DEMO-2 again", projects),
		).toEqual(["DEMO-2", "WEB-7"]);
	});

	test("respects word boundaries", () => {
		expect(extractIssueKeys("XDEMO-343", projects)).toEqual([]);
		expect(extractIssueKeys("DEMO-343a", projects)).toEqual([]);
		expect(extractIssueKeys("SOMETHING_DEMO-343", projects)).toEqual([]);
		expect(extractIssueKeys("(DEMO-343)", projects)).toEqual(["DEMO-343"]);
		expect(extractIssueKeys("DEMO-3434", projects)).toEqual(["DEMO-3434"]);
	});

	test("ignores projects that do not exist in RVNA", () => {
		expect(extractIssueKeys("NOPE-12", projects)).toEqual([]);
		expect(extractIssueKeys("DEMO-12", [])).toEqual([]);
		expect(extractIssueKeys("", projects)).toEqual([]);
	});

	test("normalises leading zeros and case", () => {
		expect(extractIssueKeys("demo-0343", projects)).toEqual(["DEMO-343"]);
		expect(extractIssueKeys("DEMO-999999999999999999999", projects)).toEqual([
			"DEMO-999999999999999999999",
		]);
	});

	test("ignores blank project keys", () => {
		expect(extractIssueKeys("fix -123", [""])).toEqual([]);
		expect(extractIssueKeys("fix -123", ["  "])).toEqual([]);
	});
});

describe("smart commit parsing", () => {
	const options = {
		projectKeys: projects,
		commandNames: ["Start progress", "Finish", "Reopen"],
	};

	test("parses comment, time and transition commands", () => {
		const lines = parseSmartCommitMessage(
			"DEMO-1 #comment deployed to staging\nDEMO-1 #time 1h 30m\nDEMO-1 #Start progress",
			options,
		);

		expect(lines).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "comment", text: "deployed to staging" }],
			},
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "time", seconds: 5400, text: "1h 30m" }],
			},
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "transition", name: "Start progress" }],
			},
		]);
	});

	test("a hash-prefixed issue key is not a transition", () => {
		const transitionOptions = {
			projectKeys: projects,
			commandNames: ["DEMO", "Done"],
		};
		expect(
			parseSmartCommitMessage("DEMO-1 #DEMO-1", transitionOptions),
		).toEqual([]);
		expect(
			parseSmartCommitMessage("DEMO-1 #Done-extra", transitionOptions),
		).toEqual([]);
		expect(parseSmartCommitMessage("DEMO-1 #Done", transitionOptions)).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "transition", name: "Done" }],
			},
		]);
	});

	test("an invalid time marker stays in the comment", () => {
		expect(
			parseSmartCommitMessage("DEMO-1 #comment fixed in #time soon", options),
		).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "comment", text: "fixed in #time soon" }],
			},
		]);
		expect(
			parseSmartCommitMessage("DEMO-1 #comment see #time", options),
		).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "comment", text: "see #time" }],
			},
		]);
		expect(
			parseSmartCommitMessage(
				"DEMO-1 #comment fixed in #time soon #Finish",
				options,
			),
		).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [
					{ kind: "comment", text: "fixed in #time soon" },
					{ kind: "transition", name: "Finish" },
				],
			},
		]);
	});

	test("a hash inside a comment stays in the comment", () => {
		const lines = parseSmartCommitMessage(
			"DEMO-1 #comment fixed in #123, see #nothing",
			options,
		);
		expect(lines).toEqual([
			{
				keys: ["DEMO-1"],
				commands: [{ kind: "comment", text: "fixed in #123, see #nothing" }],
			},
		]);
	});

	test("commands apply only to keys on their line", () => {
		const lines = parseSmartCommitMessage(
			"DEMO-1 WEB-2 #comment both\nDEMO-3 just a reference",
			options,
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]?.keys).toEqual(["DEMO-1", "WEB-2"]);
	});

	test("an invalid time is not a command", () => {
		const lines = parseSmartCommitMessage("DEMO-1 #time soon", options);
		expect(lines).toEqual([]);
	});

	test("time durations follow the app's calendar", () => {
		expect(parseTimeSpent("1h 30m")).toBe(5400);
		expect(parseTimeSpent("2d")).toBe(2 * 8 * 3600);
		expect(parseTimeSpent("1w")).toBe(5 * 8 * 3600);
		expect(parseTimeSpent("45")).toBe(45 * 60);
		expect(parseTimeSpent("")).toBeNull();
		expect(parseTimeSpent("1h and 30m")).toBeNull();
	});

	test("hostile text stays a comment", () => {
		const lines = parseSmartCommitMessage(
			"DEMO-1 #comment <script>alert(1)</script>",
			options,
		);
		expect(lines[0]?.commands).toEqual([
			{ kind: "comment", text: "<script>alert(1)</script>" },
		]);
	});
});

describe("branch names", () => {
	test("slugify the summary", () => {
		expect(summarySlug("Fix the login redirect!")).toBe(
			"fix-the-login-redirect",
		);
		expect(branchNameFor("demo-343", "Fix the login redirect!")).toBe(
			"DEMO-343-fix-the-login-redirect",
		);
		expect(summarySlug("???")).toBe("task");
	});

	test("keeps non-Latin summaries and folds accents", () => {
		expect(summarySlug("Café résumé")).toBe("cafe-resume");
		expect(summarySlug("修复登录")).toBe("修复登录");
		expect(summarySlug("Вход в систему")).toBe("вход-в-систему");
		expect(branchNameFor("demo-1", "修复登录")).toBe("DEMO-1-修复登录");
	});
});
