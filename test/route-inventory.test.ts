import { expect, test } from "vitest";
import * as aliased from "./fixtures/actions-aliased.ts";
import * as listed from "./fixtures/actions-listed.ts";
import * as reexported from "./fixtures/actions-reexported.ts";
import { actionNames, actionUrls, allAppRoutes } from "./route-inventory.ts";

test("the inventory sees an action however the module exports it", () => {
	expect(actionNames(listed)).toEqual(["default", "rename"]);
	expect(actionNames(reexported)).toEqual(["default", "rename"]);
	expect(actionNames(aliased)).toEqual(["archive"]);
	expect(actionNames({})).toEqual([]);
	expect(actionNames(undefined)).toEqual([]);
});

test("page actions come from the built routes and give one address per action", async () => {
	const routes = await allAppRoutes();
	const login = routes.find(
		(route) => route.method === "POST" && route.pattern === "/login.jsp",
	);
	expect(login?.actions).toEqual(["default"]);
	expect(
		actionUrls({ ...login, actions: ["default", "rename"] } as never, "/x"),
	).toEqual(["/x", "/x?/rename"]);
});
