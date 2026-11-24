import { expect, test } from "vitest";
import { wikiCreateTarget } from "../src/lib/wiki/context.ts";

test("the Create button target survives a malformed percent escape in the address", () => {
	for (const path of ["/display/%E0%A4", "/spaces/%E0%A4/overview"]) {
		expect(wikiCreateTarget(path, "")).toContain("/pages/createpage.action");
	}
});
