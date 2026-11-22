import { expect, test } from "vitest";
import { projectPage } from "../src/lib/server/project-keys/service.ts";

test("a project address in another case is not redirected to itself", async () => {
	const outcome = await projectPage(null, {
		pathname: "/projects/Demo/summary",
		search: "",
		resolvedKey: "Demo",
	});
	expect(outcome).toEqual({ kind: "none" });
});

test("a previous key redirects to the current key in upper case", async () => {
	const outcome = await projectPage(null, {
		pathname: "/projects/old-key/summary",
		search: "?tab=1",
		resolvedKey: "new-key",
	});
	expect(outcome).toEqual({
		kind: "redirect",
		location: "/projects/NEW-KEY/summary?tab=1",
	});
});

test("a project address keeps its query string", async () => {
	const outcome = await projectPage(null, {
		pathname: "/browse/DEMO",
		search: "?jql=project%20%3D%20DEMO",
		resolvedKey: "DEMO",
	});
	expect(outcome).toEqual({
		kind: "redirect",
		location: "/projects/DEMO/summary?jql=project%20%3D%20DEMO",
	});
});
