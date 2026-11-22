import { expect, test } from "vitest";
import {
	convertStorageElements,
	decodeEntities,
	escapeHtml,
	findMacros,
	parseParameters,
	type StorageContext,
} from "../src/lib/server/wiki/storage.ts";

const context: StorageContext = {
	pageSourceId: "1",
	spaceKey: "FIX",
	attachments: new Map(),
	pageSourceIdByTitle: new Map(),
	otherSpacePages: new Map(),
	inlineMarkers: new Set(),
};

test("storage emoticons render as their characters", () => {
	const names: [string, string][] = [
		["smile", "🙂"],
		["sad", "🙁"],
		["cheeky", "😛"],
		["laugh", "😄"],
		["thumbs_up", "👍"],
		["thumbs_down", "👎"],
		["lightbulb", "💡"],
		["music", "🎵"],
	];
	for (const [name, character] of names) {
		const html = convertStorageElements(
			`<p><ac:emoticon ac:name="${name}"/></p>`,
			context,
		);
		expect(html).toContain(character);
		expect(html).not.toContain("U0001");
	}
});

test("storage escaping is the shared HTML escaping", () => {
	expect(escapeHtml(`<a href='x'>O'Brien & "q"</a>`)).toBe(
		"&lt;a href=&#39;x&#39;&gt;O&#39;Brien &amp; &quot;q&quot;&lt;/a&gt;",
	);
});

test("entity and lookup names from Object.prototype stay literal", () => {
	expect(decodeEntities("&constructor; &toString;")).toBe(
		"&constructor; &toString;",
	);
	const html = convertStorageElements(
		'<ac:layout-section ac:type="constructor"><ac:layout-cell>x</ac:layout-cell></ac:layout-section><ac:emoticon ac:name="constructor"/>',
		context,
	);
	expect(html).toContain("wiki-layout-single");
	expect(html).not.toContain("function");
	expect(html).toContain("🙂");
});

test("a self-closing parameter does not swallow the next parameter", () => {
	expect(
		parseParameters(
			'<ac:parameter ac:name="a"/><ac:parameter ac:name="b">value</ac:parameter>',
		),
	).toEqual({ a: "", b: "value" });
});

test("CDATA text is not decoded as entities", () => {
	const [macro] = findMacros(
		'<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[a &amp; b &#39;c&#39;]]></ac:plain-text-body></ac:structured-macro>',
	);
	expect(macro?.plain).toBe("a &amp; b &#39;c&#39;");
	const [plain] = findMacros(
		'<ac:structured-macro ac:name="code"><ac:plain-text-body>a &amp; b</ac:plain-text-body></ac:structured-macro>',
	);
	expect(plain?.plain).toBe("a & b");
});
