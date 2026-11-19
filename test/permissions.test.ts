import { describe, expect, test } from "vitest";
import {
	type ActorLike,
	DEFAULT_SCHEME_GRANTS,
	decidePermission,
	type GrantLike,
	type PermissionProject,
	type PermissionUser,
} from "../src/lib/server/permissions.ts";

const user: PermissionUser = {
	id: "user-1",
	username: "alice",
	groups: ["developers", "staff"],
	isAdmin: false,
};

const project: PermissionProject = {
	id: "project-1",
	key: "PRJ",
	leadId: "lead-1",
};

const issue = {
	id: "issue-1",
	reporterId: "reporter-1",
	assigneeId: "assignee-1",
};

function allows(
	permissionKey: string,
	grants: GrantLike[],
	options: {
		actors?: ActorLike[];
		issue?: typeof issue | null;
		user?: Partial<PermissionUser>;
		project?: Partial<PermissionProject>;
		globalAdmin?: boolean;
	} = {},
) {
	return decidePermission({
		permissionKey,
		user: { ...user, ...options.user },
		project: { ...project, ...options.project },
		issue: options.issue === undefined ? issue : options.issue,
		grants,
		actors: options.actors ?? [],
		globalAdmin: options.globalAdmin ?? false,
	});
}

describe("permission decision table", () => {
	test("anyone and applicationRole holders", () => {
		expect(
			allows("BROWSE_PROJECTS", [
				{
					permissionKey: "BROWSE_PROJECTS",
					holderType: "anyone",
					holderParameter: null,
				},
			]),
		).toBe(true);
		expect(
			allows("BROWSE_PROJECTS", [
				{
					permissionKey: "BROWSE_PROJECTS",
					holderType: "applicationRole",
					holderParameter: "jira-software",
				},
			]),
		).toBe(true);
	});

	test("group and user holders are matched case-insensitively", () => {
		expect(
			allows("EDIT_ISSUES", [
				{
					permissionKey: "EDIT_ISSUES",
					holderType: "group",
					holderParameter: "DEVELOPERS",
				},
			]),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", [
				{
					permissionKey: "EDIT_ISSUES",
					holderType: "group",
					holderParameter: "ops",
				},
			]),
		).toBe(false);
		expect(
			allows("EDIT_ISSUES", [
				{
					permissionKey: "EDIT_ISSUES",
					holderType: "user",
					holderParameter: "ALICE",
				},
			]),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", [
				{
					permissionKey: "EDIT_ISSUES",
					holderType: "user",
					holderParameter: "bob",
				},
			]),
		).toBe(false);
	});

	test("project roles match a user actor and a group actor", () => {
		const grants: GrantLike[] = [
			{
				permissionKey: "EDIT_ISSUES",
				holderType: "projectRole",
				holderParameter: "10001",
			},
		];
		expect(
			allows("EDIT_ISSUES", grants, {
				actors: [
					{
						roleId: "10001",
						roleName: "Developers",
						actorType: "user",
						actorParameter: "alice",
					},
				],
			}),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", grants, {
				actors: [
					{
						roleId: "10001",
						roleName: "Developers",
						actorType: "group",
						actorParameter: "developers",
					},
				],
			}),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", grants, {
				actors: [
					{
						roleId: "10001",
						roleName: "Developers",
						actorType: "group",
						actorParameter: "ops",
					},
				],
			}),
		).toBe(false);
	});

	test("reporter, assignee and project lead holders depend on the issue", () => {
		expect(
			allows(
				"EDIT_ISSUES",
				[
					{
						permissionKey: "EDIT_ISSUES",
						holderType: "reporter",
						holderParameter: null,
					},
				],
				{ user: { id: "reporter-1" } },
			),
		).toBe(true);
		expect(
			allows(
				"EDIT_ISSUES",
				[
					{
						permissionKey: "EDIT_ISSUES",
						holderType: "reporter",
						holderParameter: null,
					},
				],
				{ user: { id: "someone-else" } },
			),
		).toBe(false);
		expect(
			allows(
				"EDIT_ISSUES",
				[
					{
						permissionKey: "EDIT_ISSUES",
						holderType: "assignee",
						holderParameter: null,
					},
				],
				{ user: { id: "assignee-1" } },
			),
		).toBe(true);
		expect(
			allows(
				"ADMINISTER_PROJECTS",
				[
					{
						permissionKey: "ADMINISTER_PROJECTS",
						holderType: "projectLead",
						holderParameter: null,
					},
				],
				{ user: { id: "lead-1" } },
			),
		).toBe(true);
		expect(
			allows(
				"EDIT_ISSUES",
				[
					{
						permissionKey: "EDIT_ISSUES",
						holderType: "reporter",
						holderParameter: null,
					},
				],
				{ issue: null, user: { id: "reporter-1" } },
			),
		).toBe(false);
	});

	test("a different permission key does not grant the check", () => {
		expect(
			allows("DELETE_ISSUES", [
				{
					permissionKey: "EDIT_ISSUES",
					holderType: "anyone",
					holderParameter: null,
				},
			]),
		).toBe(false);
	});

	test("application administrators and global ADMINISTER holders pass everything", () => {
		expect(allows("ADMINISTER_PROJECTS", [], { user: { isAdmin: true } })).toBe(
			true,
		);
		expect(allows("DELETE_ISSUES", [], { globalAdmin: true })).toBe(true);
	});
});

describe("built-in default scheme", () => {
	const actors: ActorLike[] = [
		{
			roleId: "admin",
			roleName: "admin",
			actorType: "user",
			actorParameter: "alice",
		},
		{
			roleId: "member",
			roleName: "member",
			actorType: "group",
			actorParameter: "developers",
		},
		{
			roleId: "viewer",
			roleName: "viewer",
			actorType: "user",
			actorParameter: "alice",
		},
	];

	test("admin administers, member works and viewer browses", () => {
		expect(
			allows("ADMINISTER_PROJECTS", DEFAULT_SCHEME_GRANTS, {
				actors,
				user: { username: "alice", groups: [] },
			}),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", DEFAULT_SCHEME_GRANTS, {
				actors,
				user: { username: "alice", groups: ["developers"] },
			}),
		).toBe(true);
		expect(
			allows("EDIT_ISSUES", DEFAULT_SCHEME_GRANTS, {
				actors: actors.filter((actor) => actor.roleName === "viewer"),
				user: { username: "alice", groups: [] },
			}),
		).toBe(false);
		expect(
			allows("BROWSE_PROJECTS", DEFAULT_SCHEME_GRANTS, {
				actors: [],
				user: { username: "nobody", groups: [] },
			}),
		).toBe(true);
	});
});
