import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { components, projects, versions } from "../src/lib/server/schema.ts";
import { makeUser, newRun, type TestUser } from "./admin-helpers.ts";
import { buildServer, cleanupTestData } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const run = newRun();
let app: TestApp;
let admin: TestUser;
let projectId: string;
let projectKey: string;

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	admin = await makeUser(run, "archive-admin", { admin: true });
	const [project] = await db
		.insert(projects)
		.values({
			sourceId: `test:${run}:archive-project`,
			key: `AR${run.slice(0, 4).toUpperCase()}`,
			name: `Archive ${run}`,
			projectType: "software",
			archived: true,
			lastIssueNumber: 0,
		})
		.returning({ id: projects.id, key: projects.key });
	projectId = project.id;
	projectKey = project.key;
});

afterAll(async () => {
	await db.delete(projects).where(eq(projects.id, projectId));
	await cleanupTestData(run);
	await app.close();
	await pool.end();
});

test("the archive action rejects a missing state instead of restoring", async () => {
	const response = await app.inject({
		method: "POST",
		url: "/secure/project/ViewProjects.jspa",
		cookies: { sid: admin.session },
		headers: {
			origin: "http://127.0.0.1:3000",
			"content-type": "application/x-www-form-urlencoded",
			accept: "application/json",
			"x-sveltekit-action": "true",
		},
		payload: new URLSearchParams({
			intent: "archive",
			key: projectKey,
		}).toString(),
	});

	expect(response.statusCode).toBe(400);
	const body = response.json() as { type: string; status: number };
	expect(body).toMatchObject({ type: "failure", status: 400 });
	expect(response.body).toContain("Invalid archive state");
	const [project] = await db
		.select({ archived: projects.archived })
		.from(projects)
		.where(eq(projects.id, projectId));
	expect(project?.archived).toBe(true);
});

test("the summary action rejects an archived or foreign component and version", async () => {
	const key = (label: string) => `${label}${run.slice(0, 4).toUpperCase()}`;
	const project = async (label: string, archived = false) => {
		const [row] = await db
			.insert(projects)
			.values({
				sourceId: `test:${run}:summary-${label}`,
				key: key(label),
				name: `Summary ${label} ${run}`,
				projectType: "software",
				archived,
				lastIssueNumber: 0,
			})
			.returning({ id: projects.id, key: projects.key });
		return row;
	};
	const active = await project("SA");
	const archived = await project("SB", true);
	const foreign = await project("SC");
	const component = async (projectId: string, name: string) => {
		const [row] = await db
			.insert(components)
			.values({ sourceId: `local:${randomUUID()}`, projectId, name })
			.returning({ id: components.id });
		return row;
	};
	const version = async (projectId: string, name: string) => {
		const [row] = await db
			.insert(versions)
			.values({ sourceId: `local:${randomUUID()}`, projectId, name })
			.returning({ id: versions.id });
		return row;
	};
	const archivedComponent = await component(archived.id, "Archived component");
	const archivedVersion = await version(archived.id, "Archived version");
	const foreignComponent = await component(foreign.id, "Foreign component");
	const foreignVersion = await version(foreign.id, "Foreign version");
	const ownComponent = await component(active.id, "Own component");
	const ownVersion = await version(active.id, "Own version");
	const post = (fields: Record<string, string>) =>
		app.inject({
			method: "POST",
			url: `/plugins/servlet/project-config/${active.key}/summary`,
			cookies: { sid: admin.session },
			headers: {
				origin: "http://127.0.0.1:3000",
				"content-type": "application/x-www-form-urlencoded",
				accept: "application/json",
				"x-sveltekit-action": "true",
			},
			payload: new URLSearchParams(fields).toString(),
		});
	const componentName = async (id: string) => {
		const [row] = await db
			.select({ name: components.name })
			.from(components)
			.where(eq(components.id, id));
		return row?.name;
	};
	const versionName = async (id: string) => {
		const [row] = await db
			.select({ name: versions.name })
			.from(versions)
			.where(eq(versions.id, id));
		return row?.name;
	};

	try {
		const archivedComponentResponse = await post({
			intent: "component",
			componentId: archivedComponent.id,
			name: "Changed archived component",
		});
		expect(archivedComponentResponse.statusCode).toBe(403);
		expect(archivedComponentResponse.body).toContain(
			"This project is archived and read-only",
		);

		const archivedVersionResponse = await post({
			intent: "version",
			versionId: archivedVersion.id,
			name: "Changed archived version",
		});
		expect(archivedVersionResponse.statusCode).toBe(403);
		expect(archivedVersionResponse.body).toContain(
			"This project is archived and read-only",
		);

		const foreignComponentResponse = await post({
			intent: "component",
			componentId: foreignComponent.id,
			name: "Changed foreign component",
		});
		expect(foreignComponentResponse.statusCode).toBe(404);
		expect(foreignComponentResponse.body).toContain("Component not found");

		const foreignVersionResponse = await post({
			intent: "version",
			versionId: foreignVersion.id,
			name: "Changed foreign version",
		});
		expect(foreignVersionResponse.statusCode).toBe(404);
		expect(foreignVersionResponse.body).toContain("Version not found");

		expect(await componentName(archivedComponent.id)).toBe(
			"Archived component",
		);
		expect(await componentName(foreignComponent.id)).toBe("Foreign component");
		expect(await versionName(archivedVersion.id)).toBe("Archived version");
		expect(await versionName(foreignVersion.id)).toBe("Foreign version");

		const ownComponentResponse = await post({
			intent: "component",
			componentId: ownComponent.id,
			name: "Renamed own component",
		});
		expect(ownComponentResponse.statusCode).toBe(200);
		const ownVersionResponse = await post({
			intent: "version",
			versionId: ownVersion.id,
			name: "Renamed own version",
		});
		expect(ownVersionResponse.statusCode).toBe(200);
		expect(await componentName(ownComponent.id)).toBe("Renamed own component");
		expect(await versionName(ownVersion.id)).toBe("Renamed own version");
	} finally {
		await db
			.delete(projects)
			.where(inArray(projects.id, [active.id, archived.id, foreign.id]));
	}
});
