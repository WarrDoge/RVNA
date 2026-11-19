import { expect, test } from "vitest";
import { profileJql } from "../src/routes/secure/ViewProfile.jspa/profile-jql.ts";

test("the profile JQL quotes a username with backslashes and quotes", () => {
	expect(profileJql({ isSelf: false, username: "alice\\" })).toBe(
		'assignee = "alice\\\\" AND resolution = Unresolved',
	);
	expect(profileJql({ isSelf: false, username: 'ali"ce' })).toBe(
		'assignee = "ali\\"ce" AND resolution = Unresolved',
	);
	expect(profileJql({ isSelf: true, username: "alice" })).toBe(
		"assignee = currentUser() AND resolution = Unresolved",
	);
});
