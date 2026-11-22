import { expect, test } from "vitest";
import {
	DESCRIPTION_LIMIT,
	plainTextToHtml,
	truncate,
} from "../src/lib/server/messenger/text.ts";

test("the description limit leaves room for the worst-case escaping", () => {
	const html = plainTextToHtml(truncate('"'.repeat(45_000), DESCRIPTION_LIMIT));
	expect(html.length).toBeLessThanOrEqual(200_000);
	expect(DESCRIPTION_LIMIT * 6).toBeLessThanOrEqual(200_000);
});
