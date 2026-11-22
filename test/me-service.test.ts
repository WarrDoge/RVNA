import { expect, test } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { me } from "../src/lib/server/me/service.ts";

const actor: CurrentUser = {
	id: "00000000-0000-4000-8000-000000000001",
	username: "ada",
	displayName: "Ada Lovelace",
	email: "ada@example.com",
	avatarUrl: null,
	groups: ["team-a"],
	isAdmin: false,
	mustChangePassword: false,
	hasPassword: true,
};

test("the response copies the groups instead of sharing the actor's array", () => {
	const response = me(actor);
	expect(response).toEqual(actor);

	response.groups.push("team-b");
	response.groups.sort();
	expect(actor.groups).toEqual(["team-a"]);
});
