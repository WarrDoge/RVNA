import { describe, expect, it } from "vitest";
import {
	applyFieldValues,
	fieldValue,
	filterToc,
	getParam,
	macroCatalog,
	macroDef,
	newMacroAttrs,
	newMacroId,
} from "../src/lib/editor/wiki/macros.ts";

const required = [
	"toc",
	"code",
	"info",
	"tip",
	"note",
	"warning",
	"panel",
	"children",
	"jira",
	"view-file",
	"recently-updated",
	"contributors",
	"contentbylabel",
	"widget",
	"attachments",
	"anchor",
	"details",
	"detailssummary",
	"expand",
];

describe("macro catalog", () => {
	it("has every macro of the brief exactly once", () => {
		const names = macroCatalog.map((def) => def.name);
		expect(new Set(names).size).toBe(names.length);
		expect([...names].sort()).toEqual([...required].sort());
	});

	it("gives every field a unique name, a label and a valid default", () => {
		for (const def of macroCatalog) {
			expect(def.label).not.toBe("");
			const names = def.fields.map((field) => field.name);
			expect(new Set(names).size, def.name).toBe(names.length);
			for (const field of def.fields) {
				expect(field.label, `${def.name}.${field.name}`).not.toBe("");
				expect(typeof field.default).toBe("string");
				if (field.type === "checkbox") {
					expect(["true", "false"]).toContain(field.default);
				}
				if (field.type === "select") {
					const values = field.options?.map((option) => option.value) ?? [];
					expect(values.length, `${def.name}.${field.name}`).toBeGreaterThan(0);
					expect(values).toContain(field.default);
				}
			}
		}
	});

	it("keeps the body kinds and inline macros the document model expects", () => {
		const rich = macroCatalog
			.filter((def) => def.body === "rich")
			.map((def) => def.name);
		expect(rich.sort()).toEqual(
			["details", "expand", "info", "note", "panel", "tip", "warning"].sort(),
		);
		expect(macroDef("code")?.body).toBe("plain");
		expect(
			macroCatalog
				.filter((def) => def.inline)
				.map((def) => def.name)
				.sort(),
		).toEqual(["anchor", "jira"]);
		expect(macroDef("anchor")?.fields[0].name).toBe("");
	});

	it("builds attrs for a new macro", () => {
		const code = newMacroAttrs(macroDef("code") ?? macroCatalog[0]);
		expect(code).toMatchObject({
			name: "code",
			bodyType: "plain",
			body: "",
			params: [],
		});
		const info = newMacroAttrs(macroDef("info") ?? macroCatalog[0]);
		expect(info).toMatchObject({ bodyType: "rich", body: null });
		const toc = newMacroAttrs(macroDef("toc") ?? macroCatalog[0]);
		expect(toc).toMatchObject({ bodyType: null, body: null });
		expect(newMacroId()).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});
});

describe("parameter helpers", () => {
	const code = macroDef("code");
	const fields = code?.fields ?? [];

	it("reads values and falls back to the default", () => {
		const params = [{ name: "language", value: "bash" }];
		expect(getParam(params, "language")).toBe("bash");
		expect(getParam(params, "title")).toBeUndefined();
		const language = fields.find((field) => field.name === "language");
		expect(language && fieldValue(params, language)).toBe("bash");
		expect(language && fieldValue([], language)).toBe("none");
	});

	it("keeps unknown parameters, their order and refs", () => {
		const ref = { tag: "ri:page", attrs: { "ri:content-title": "X" } };
		const params = [
			{ name: "zzz", value: "keep" },
			{ name: "title", value: "old" },
			{ name: "page", value: "X", ref },
		];
		const next = applyFieldValues(params, fields, {
			title: "new",
			language: "python",
			linenumbers: "true",
		});
		expect(next.map((param) => param.name)).toEqual([
			"zzz",
			"title",
			"page",
			"language",
			"linenumbers",
		]);
		expect(next[1].value).toBe("new");
		expect(next[2].ref).toEqual(ref);
		expect(params[1].value).toBe("old");
	});

	it("does not add defaults, and removes a cleared value", () => {
		expect(
			applyFieldValues([], fields, { language: "none", linenumbers: "false" }),
		).toEqual([]);
		const next = applyFieldValues([{ name: "title", value: "t" }], fields, {
			title: "",
		});
		expect(next).toEqual([]);
	});

	it("leaves a parameter alone when its value did not change", () => {
		const ref = { tag: "ri:page", attrs: {} };
		const params = [{ name: "title", value: "t", ref }];
		expect(applyFieldValues(params, fields, { title: "t" })[0].ref).toEqual(
			ref,
		);
	});

	it("writes the unnamed parameter of anchor under the empty name", () => {
		const anchor = macroDef("anchor")?.fields ?? [];
		expect(applyFieldValues([], anchor, { "": "top" })).toEqual([
			{ name: "", value: "top" },
		]);
		expect(
			applyFieldValues([{ name: "", value: "top" }], anchor, { "": "end" }),
		).toEqual([{ name: "", value: "end" }]);
	});
});

describe("filterToc", () => {
	const headings = [
		{ level: 1, text: "Intro" },
		{ level: 2, text: "Setup" },
		{ level: 3, text: "Details" },
		{ level: 2, text: "Appendix" },
	];

	it("limits by level and by include and exclude patterns", () => {
		expect(filterToc(headings, []).length).toBe(4);
		expect(
			filterToc(headings, [
				{ name: "minLevel", value: "2" },
				{ name: "maxLevel", value: "2" },
			]).map((entry) => entry.text),
		).toEqual(["Setup", "Appendix"]);
		expect(
			filterToc(headings, [{ name: "include", value: "^(Intro|Setup)$" }])
				.length,
		).toBe(2);
		expect(
			filterToc(headings, [{ name: "exclude", value: "App" }]).length,
		).toBe(3);
	});

	it("ignores an invalid regular expression", () => {
		expect(filterToc(headings, [{ name: "include", value: "(" }]).length).toBe(
			4,
		);
	});

	it("does not run a hostile pattern over a long heading", () => {
		const hostile = [{ level: 1, text: `${"a".repeat(27)}!` }];
		const started = performance.now();
		const shown = filterToc(hostile, [{ name: "include", value: "(a+)+$" }]);
		expect(performance.now() - started).toBeLessThan(1000);
		expect(shown).toEqual(hostile);
	});

	it("ignores patterns that are too long or contain a nested quantifier", () => {
		const long = `^${"a".repeat(201)}$`;
		expect(filterToc(headings, [{ name: "include", value: long }]).length).toBe(
			4,
		);
		expect(
			filterToc(headings, [{ name: "exclude", value: "(a|aa)+$" }]).length,
		).toBe(4);
	});
});
