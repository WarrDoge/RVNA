import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const allowed = ["@atlaskit/pragmatic-drag-and-drop"];

function files(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...files(path));
		else if (/\.(ts|svelte|css)$/.test(entry.name)) out.push(path);
	}
	return out;
}

test("src/lib and src/routes import only the framework-free drag and drop package from Atlaskit", () => {
	const offenders: string[] = [];
	for (const file of [...files("src/lib"), ...files("src/routes")]) {
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(
			/(?:@?import\s*\(?\s*|from\s*)["'](@atlaskit\/[^"']+)["']/g,
		)) {
			const specifier = match[1];
			if (
				!allowed.some(
					(prefix) =>
						specifier === prefix || specifier.startsWith(`${prefix}/`),
				)
			) {
				offenders.push(`${file}: ${specifier}`);
			}
		}
	}
	expect(offenders).toEqual([]);
});
