import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "svelte/compiler";
import { expect, test } from "vitest";
import { hydrationAllowList } from "./hydration-allow-list.ts";

interface Hit {
	file: string;
	line: number;
	control: string;
}

interface AnyNode {
	type?: string;
	start?: number;
	name?: string;
	attributes?: AnyNode[];
	value?: unknown;
	[key: string]: unknown;
}

const CONTROL_ELEMENTS = new Set(["input", "textarea", "select"]);
const SKIP_INPUT_TYPES = new Set([
	"hidden",
	"submit",
	"button",
	"file",
	"reset",
	"image",
]);

function attributeName(attribute: AnyNode) {
	const name = attribute.name;
	return typeof name === "string" ? name : "";
}

function valueNodes(attribute: AnyNode): AnyNode[] {
	if (Array.isArray(attribute.value)) return attribute.value as AnyNode[];
	if (attribute.value && typeof attribute.value === "object") {
		return [attribute.value as AnyNode];
	}
	return [];
}

function staticText(attribute: AnyNode): string | null {
	const nodes = valueNodes(attribute);
	if (nodes.length === 0 || nodes.some((node) => node.type !== "Text")) {
		return null;
	}
	return nodes.map((node) => String(node.data ?? "")).join("");
}

function flaggedAttributes(attributes: AnyNode[]) {
	return attributes.filter(
		(attribute) =>
			attribute.type === "Attribute" &&
			["value", "checked"].includes(attributeName(attribute)) &&
			valueNodes(attribute).some((node) => node.type === "ExpressionTag"),
	);
}

function controlFor(node: AnyNode, attributes: AnyNode[]) {
	const typeAttribute = attributes.find(
		(attribute) =>
			attribute.type === "Attribute" && attributeName(attribute) === "type",
	);
	const type = typeAttribute ? staticText(typeAttribute) : null;
	const label =
		attributes.find(
			(attribute) =>
				attribute.type === "Attribute" &&
				attributeName(attribute) === "aria-label",
		) ??
		attributes.find(
			(attribute) =>
				attribute.type === "Attribute" && attributeName(attribute) === "name",
		) ??
		attributes.find(
			(attribute) =>
				attribute.type === "Attribute" && attributeName(attribute) === "id",
		);
	const labelText = label ? staticText(label) : null;
	let control = node.name ?? "";
	if (type) control += `[type=${type}]`;
	if (label && labelText !== null) {
		control += `[${attributeName(label)}="${labelText}"]`;
	}
	const flagged = flaggedAttributes(attributes).map(attributeName);
	return { control: `${control} (${flagged.join("+")})`, type };
}

function lineOf(source: string, start: number) {
	return source.slice(0, start).split("\n").length;
}

function walk(node: AnyNode, file: string, source: string, hits: Hit[]) {
	if (node.type === "RegularElement" && CONTROL_ELEMENTS.has(node.name ?? "")) {
		const attributes = node.attributes ?? [];
		const hasBind = attributes.some(
			(attribute) => attribute.type === "BindDirective",
		);
		const flagged = flaggedAttributes(attributes);
		if (!hasBind && flagged.length > 0) {
			const { control, type } = controlFor(node, attributes);
			const isSkippedInput =
				node.name === "input" && type !== null && SKIP_INPUT_TYPES.has(type);
			if (!isSkippedInput) {
				hits.push({
					file,
					line: lineOf(source, node.start ?? 0),
					control,
				});
			}
		}
	}
	for (const [key, value] of Object.entries(node)) {
		if (key === "parent" || key === "metadata") continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (item && typeof item === "object") {
					walk(item as AnyNode, file, source, hits);
				}
			}
		} else if (value && typeof value === "object") {
			const child = value as AnyNode;
			if (child.type) walk(child, file, source, hits);
		}
	}
}

function svelteFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...svelteFiles(path));
		else if (entry.name.endsWith(".svelte")) files.push(path);
	}
	return files;
}

function collectHits() {
	const hits: Hit[] = [];
	for (const path of svelteFiles("src")) {
		const source = readFileSync(path, "utf8");
		const ast = parse(source, { modern: true });
		walk(ast.fragment as unknown as AnyNode, relative(".", path), source, hits);
	}
	return hits;
}

function countBy<T>(items: T[], key: (item: T) => string) {
	const counts = new Map<string, number>();
	for (const item of items) {
		const value = key(item);
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

test("native controls with controlled value/checked are hydration-safe", () => {
	const hits = collectHits();
	const allowed = countBy(
		hydrationAllowList,
		(entry) => `${entry.file}\u0000${entry.control}`,
	);
	const found = countBy(hits, (hit) => `${hit.file}\u0000${hit.control}`);

	const unexpected: string[] = [];
	const seen = new Map<string, number>();
	for (const hit of hits) {
		const key = `${hit.file}\u0000${hit.control}`;
		const count = (seen.get(key) ?? 0) + 1;
		seen.set(key, count);
		if (count > (allowed.get(key) ?? 0)) {
			unexpected.push(`${hit.file}:${hit.line} ${hit.control}`);
		}
	}

	const stale: typeof hydrationAllowList = [];
	const used = new Map<string, number>();
	for (const entry of hydrationAllowList) {
		const key = `${entry.file}\u0000${entry.control}`;
		const count = (used.get(key) ?? 0) + 1;
		used.set(key, count);
		if (count > (found.get(key) ?? 0)) stale.push(entry);
	}

	expect(
		unexpected,
		`A native <input>/<textarea>/<select> has a controlled value/checked attribute and no bind:. Hydration will overwrite text typed before the page script loads. Use bind:value, bind:checked or bind:group (the function form works too) so the DOM value is adopted. If the control only renders after a user action such as a dialog, popup, menu or inline edit, add it to test/hydration-allow-list.ts with file, control and reason. Unexpected: ${unexpected.join("; ")}`,
	).toEqual([]);
	expect(
		stale,
		`test/hydration-allow-list.ts contains entries that no longer match a control. Remove them or update the control string. Stale: ${stale.map((entry) => `${entry.file} ${entry.control}`).join("; ")}`,
	).toEqual([]);
});
