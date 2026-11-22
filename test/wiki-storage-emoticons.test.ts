import { expect, test } from "vitest";
import {
	convertStorageElements,
	type StorageContext,
} from "../src/lib/server/wiki/storage.ts";

test("storage emoticons render as their characters", () => {
	const context: StorageContext = {
		pageSourceId: "1",
		spaceKey: "FIX",
		attachments: new Map(),
		pageSourceIdByTitle: new Map(),
		otherSpacePages: new Map(),
		inlineMarkers: new Set(),
	};
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
