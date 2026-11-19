import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { testConnection } from "../src/lib/server/gitlab/client.ts";
import { decryptSecret } from "../src/lib/server/gitlab/crypto.ts";
import {
	gitlabConfig,
	gitlabRepositories,
} from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	type GitlabFixture,
	uniqueTag,
} from "./gitlab-fixtures.ts";
import { adminGroup, buildServer, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

const tag = uniqueTag();
let app: TestApp;
let adminSession: string;
let userSession: string;
let fixture: GitlabFixture;
let repositoryId: string;

function inject(
	method: "GET" | "PUT" | "PATCH" | "POST" | "DELETE",
	url: string,
	session: string | null,
	payload?: unknown,
) {
	return app.inject({
		method,
		url,
		cookies: session ? { sid: session } : undefined,
		headers: {
			...(session ? { "x-requested-with": "rvna" } : {}),
			...(payload === undefined ? {} : { "content-type": "application/json" }),
		},
		payload: payload as never,
	});
}

beforeAll(async () => {
	await runMigrations();
	app = buildServer();
	fixture = await createGitlabFixture(tag);

	const admin = await login(app, {
		sub: `${tag}-admin`,
		username: `t-${tag}-admin`,
		name: "Admin",
		email: `t-${tag}-admin@example.test`,
		groups: [adminGroup()],
	});
	adminSession = admin.sessionId as string;
	const user = await login(app, {
		sub: `${tag}-user`,
		username: `t-${tag}-user`,
		name: "User",
		email: `t-${tag}-user@example.test`,
		groups: [],
	});
	userSession = user.sessionId as string;

	const [repository] = await db
		.insert(gitlabRepositories)
		.values({
			gitlabProjectId: 424242,
			path: `${tag}/service`,
			name: "service",
			webUrl: `https://gitlab.example.test/${tag}/service`,
		})
		.returning();
	repositoryId = repository.id;
});

afterAll(async () => {
	await app.close();
	await cleanupGitlabFixture(fixture);
	await db.delete(gitlabRepositories);
	await pool.query(
		"update gitlab_config set base_url = '', webhook_secret = null, access_token = null, last_delivery_at = null, last_delivery_status = null",
	);
	await pool.end();
});

describe("admin configuration", () => {
	test("is closed to non-administrators", async () => {
		expect(
			(await inject("GET", "/api/admin/gitlab", userSession)).statusCode,
		).toBe(403);
		expect(
			(
				await inject("PUT", "/api/admin/gitlab", userSession, {
					baseUrl: "https://gitlab.example.test",
				})
			).statusCode,
		).toBe(403);
		expect(
			(
				await inject(
					"GET",
					`/api/projects/${fixture.projectKey}/gitlab`,
					userSession,
				)
			).statusCode,
		).toBe(403);
	});

	test("saves the base URL and never returns the secrets", async () => {
		const saved = await inject("PUT", "/api/admin/gitlab", adminSession, {
			baseUrl: "https://gitlab.example.test/",
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json().baseUrl).toBe("https://gitlab.example.test");
		expect(saved.json().webhookUrl).toBe(
			"http://127.0.0.1:3000/api/integrations/gitlab/webhook",
		);
		expect(saved.json().hasWebhookSecret).toBe(false);

		const generated = await inject(
			"POST",
			"/api/admin/gitlab/secret",
			adminSession,
		);
		expect(generated.statusCode).toBe(200);
		const secret = generated.json().secret as string;
		expect(secret.length).toBeGreaterThan(20);
		expect(generated.json().hasWebhookSecret).toBe(true);

		const [stored] = await db.select().from(gitlabConfig);
		expect(stored?.webhookSecret).not.toBe(secret);
		expect(stored?.webhookSecret?.startsWith("v1:")).toBe(true);
		expect(decryptSecret(stored?.webhookSecret as string)).toBe(secret);

		const read = await inject("GET", "/api/admin/gitlab", adminSession);
		expect(read.statusCode).toBe(200);
		expect(read.json().hasWebhookSecret).toBe(true);
		expect(read.body).not.toContain(secret);
		expect(read.json().secret).toBeUndefined();
	});

	test("stores the access token encrypted and clears it on request", async () => {
		const token = "glpat-test-token-value";
		const saved = await inject("PUT", "/api/admin/gitlab/token", adminSession, {
			token,
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json().hasAccessToken).toBe(true);
		expect(saved.body).not.toContain(token);

		const [stored] = await db.select().from(gitlabConfig);
		expect(stored?.accessToken).not.toBe(token);
		expect(decryptSecret(stored?.accessToken as string)).toBe(token);

		const cleared = await inject(
			"DELETE",
			"/api/admin/gitlab/token",
			adminSession,
		);
		expect(cleared.statusCode).toBe(200);
		expect(cleared.json().hasAccessToken).toBe(false);
	});

	test("validates the token against /api/v4/version", async () => {
		const calls: { url: string; headers?: Record<string, string> }[] = [];
		const fetchImpl = async (
			url: string,
			init?: { headers?: Record<string, string> },
		) => {
			calls.push({ url, headers: init?.headers });
			return {
				ok: true,
				status: 200,
				headers: { get: () => null },
				json: async () => ({ version: "17.4.2" }),
				text: async () => "",
			};
		};

		const result = await testConnection(
			"https://gitlab.example.test/",
			"glpat-token",
			fetchImpl,
		);
		expect(result.version).toBe("17.4.2");
		expect(calls[0]?.url).toBe("https://gitlab.example.test/api/v4/version");
		expect(calls[0]?.headers?.["PRIVATE-TOKEN"]).toBe("glpat-token");

		await expect(
			testConnection("https://gitlab.example.test", "bad", async () => ({
				ok: false,
				status: 401,
				headers: { get: () => null },
				json: async () => ({}),
				text: async () => "401 Unauthorized",
			})),
		).rejects.toThrow("401");
	});

	test("saves the per-project repository and automation settings", async () => {
		const current = await inject(
			"GET",
			`/api/projects/${fixture.projectKey}/gitlab`,
			adminSession,
		);
		expect(current.statusCode).toBe(200);
		expect(current.json().repositories).toHaveLength(1);
		expect(current.json().availableTransitions).toEqual([
			"Start progress",
			"Finish",
			"Reopen",
		]);

		const saved = await inject(
			"PATCH",
			`/api/projects/${fixture.projectKey}/gitlab`,
			adminSession,
			{
				linkedRepositoryIds: [repositoryId],
				defaultRepositoryId: repositoryId,
				smartCommitsEnabled: true,
				mergeRequestOpenedEnabled: true,
				mergeRequestOpenedTransitions: ["Start progress"],
				mergeRequestMergedEnabled: true,
				mergeRequestMergedTransitions: ["Finish"],
			},
		);
		expect(saved.statusCode).toBe(200);
		expect(saved.json().defaultRepositoryId).toBe(repositoryId);
		expect(saved.json().linkedRepositoryIds).toEqual([repositoryId]);
		expect(saved.json().smartCommitsEnabled).toBe(true);
		expect(saved.json().mergeRequestMergedTransitions).toEqual(["Finish"]);
		expect(saved.json().repositories[0].linked).toBe(true);

		const reread = await inject(
			"GET",
			`/api/projects/${fixture.projectKey}/gitlab`,
			adminSession,
		);
		expect(reread.json().mergeRequestOpenedTransitions).toEqual([
			"Start progress",
		]);
	});
});
