import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadUser } from "../src/lib/server/auth.ts";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { projectRoleActors, projects } from "../src/lib/server/schema.ts";
import { load as loadProjects } from "../src/routes/(admin)/secure/project/ViewProjects.jspa/+page.server.ts";
import { load as loadRoles } from "../src/routes/plugins/servlet/project-config/[key]/roles/+page.server.ts";
import { load } from "../src/routes/plugins/servlet/project-config/[key]/summary/+page.server.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	linkFixtureRepository,
	uniqueTag,
} from "./gitlab-fixtures.ts";

const tag = uniqueTag();
let fixture: GitlabFixture;
let archivedProjectId: string;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	await linkFixtureRepository(fixture);
	const [archived] = await db
		.insert(projects)
		.values({
			sourceId: `${tag}:archived-project`,
			key: `AR${tag.slice(2, 6).toUpperCase()}`,
			name: `Archived ${tag}`,
			projectType: "software",
			archived: true,
			lastIssueNumber: 0,
		})
		.returning({ id: projects.id });
	archivedProjectId = archived.id;
	await db.insert(projectRoleActors).values({
		sourceId: `${tag}:project-admin`,
		projectId: fixture.projectId,
		roleId: "admin",
		roleName: "admin",
		actorType: "user",
		actorParameter: `gl-${fixture.tag}`,
		actorDisplayName: "GitLab Tester",
		raw: { role: "admin", actor: `gl-${fixture.tag}` },
	});
});

afterAll(async () => {
	await db.delete(projects).where(eq(projects.id, archivedProjectId));
	await cleanupGitlabFixture(fixture);
	await pool.end();
});

function summaryEvent(
	user: Awaited<ReturnType<typeof loadUser>>,
	key = fixture.projectKey,
) {
	return {
		locals: { user },
		params: { key },
		url: new URL(
			`http://127.0.0.1:3000/plugins/servlet/project-config/${fixture.projectKey}/summary`,
		),
		route: { id: "/plugins/servlet/project-config/[key]/summary" },
		depends: () => {},
	};
}

describe("project settings GitLab data", () => {
	test("is not returned to a project administrator who is not a site administrator", async () => {
		const user = await loadUser(fixture.userId);
		expect(user?.isAdmin).toBe(false);

		const data = await load(summaryEvent(user) as never);

		expect(data.sidebar?.canAdminister).toBe(true);
		expect(data.project).not.toBeNull();
		expect(data.gitlab).toBeNull();
	});

	test("is returned to a site administrator", async () => {
		const user = await loadUser(fixture.userId);
		if (!user) throw new Error("fixture user is missing");

		const data = await load(summaryEvent({ ...user, isAdmin: true }) as never);

		expect(data.gitlab).not.toBeNull();
		expect(
			data.gitlab?.repositories.some((repository) => repository.linked),
		).toBe(true);
	});

	test("the project list reads its filter from the address", async () => {
		const user = await loadUser(fixture.userId);
		if (!user) throw new Error("fixture user is missing");

		const data = await loadProjects({
			locals: { user: { ...user, isAdmin: true } },
			params: {},
			url: new URL(
				"http://127.0.0.1:3000/secure/project/ViewProjects.jspa?filter=archived",
			),
			route: { id: "/secure/project/ViewProjects.jspa" },
			depends: () => {},
		} as never);

		expect(data.filter).toBe("archived");
		expect(data.projects.length).toBeGreaterThan(0);
		expect(data.projects.every((project) => project.archived)).toBe(true);
		expect(
			data.projects.some((project) => project.id === fixture.projectId),
		).toBe(false);
	});

	test("a missing project is a 403 for a member and 404 for a site administrator", async () => {
		const user = await loadUser(fixture.userId);
		if (!user) throw new Error("fixture user is missing");

		await expect(
			load(summaryEvent(user, "MISSING") as never),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			loadRoles(summaryEvent(user, "MISSING") as never),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			load(summaryEvent({ ...user, isAdmin: true }, "MISSING") as never),
		).rejects.toMatchObject({ status: 404 });
	});
});
