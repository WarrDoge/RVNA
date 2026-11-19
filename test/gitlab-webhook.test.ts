import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import {
	saveBaseUrl,
	saveWebhookSecret,
} from "../src/lib/server/gitlab/config.ts";
import { constantTimeEqual } from "../src/lib/server/gitlab/crypto.ts";
import {
	dominantMergeRequestState,
	issueDevelopment,
	mergeRequestLozenge,
} from "../src/lib/server/gitlab/development.ts";
import {
	gitlabBranches,
	gitlabCommits,
	gitlabDeliveries,
	gitlabMergeRequests,
} from "../src/lib/server/schema-gitlab.ts";
import {
	cleanupGitlabFixture,
	createGitlabFixture,
	delivery,
	type GitlabFixture,
	mergeRequestPayload,
	pipelinePayload,
	projectPayload,
	pushPayload,
	uniqueTag,
	waitForDelivery,
} from "./gitlab-fixtures.ts";
import { buildServer } from "./helpers.ts";
import type { TestApp } from "./server.ts";

vi.mock("../src/lib/server/gitlab/crypto.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/lib/server/gitlab/crypto.ts")>();
	return {
		...actual,
		constantTimeEqual: vi.fn(actual.constantTimeEqual),
	};
});

const secret = "gitlab-webhook-secret";
const tag = uniqueTag();
let fixture: GitlabFixture;
let app: TestApp;

beforeAll(async () => {
	await runMigrations();
	fixture = await createGitlabFixture(tag);
	await saveBaseUrl("https://gitlab.example.test");
	await saveWebhookSecret(secret);
	app = buildServer();
});

afterAll(async () => {
	await app.close();
	await cleanupGitlabFixture(fixture);
	await pool.query(
		"update gitlab_config set base_url = '', webhook_secret = null, access_token = null, last_delivery_at = null, last_delivery_status = null",
	);
	await pool.end();
});

describe("webhook authentication", () => {
	test("rejects a missing, wrong or unconfigured token", async () => {
		const payload = pushPayload(fixture, "main", [
			{ sha: "a".repeat(40), title: "noop" },
		]);

		const missing = await app.inject({
			method: "POST",
			url: "/api/integrations/gitlab/webhook",
			headers: { "x-gitlab-event": "Push Hook" },
			payload,
		});
		expect(missing.statusCode).toBe(401);

		const wrong = await delivery(
			app,
			"wrong-secret",
			"Push Hook",
			payload,
			`${tag}:wrong`,
		);
		expect(wrong.statusCode).toBe(401);

		await pool.query("update gitlab_config set webhook_secret = null");
		const unconfigured = await delivery(
			app,
			secret,
			"Push Hook",
			payload,
			`${tag}:none`,
		);
		expect(unconfigured.statusCode).toBe(401);

		await saveWebhookSecret(secret);
	});

	test("uses the endpoint body parser: guarded JSON and JSON media types", async () => {
		const guarded = await app.inject({
			method: "POST",
			url: "/api/integrations/gitlab/webhook",
			headers: {
				"x-gitlab-token": secret,
				"x-gitlab-event": "Push Hook",
				"content-type": "application/json",
			},
			payload: '{"__proto__":{"x":1}}',
		});
		expect([guarded.statusCode, guarded.json().code]).toEqual([
			400,
			"FST_ERR_CTP_INVALID_JSON_BODY",
		]);

		const xml = await app.inject({
			method: "POST",
			url: "/api/integrations/gitlab/webhook",
			headers: {
				"x-gitlab-token": secret,
				"x-gitlab-event": "Push Hook",
				"content-type": "application/xml",
			},
			payload: "<x/>",
		});
		expect([xml.statusCode, xml.json().code]).toEqual([
			415,
			"FST_ERR_CTP_INVALID_MEDIA_TYPE",
		]);

		const text = await app.inject({
			method: "POST",
			url: "/api/integrations/gitlab/webhook",
			headers: {
				"x-gitlab-token": secret,
				"x-gitlab-event": "Push Hook",
				"content-type": "text/plain",
			},
			payload: "hello",
		});
		expect([text.statusCode, text.json()]).toEqual([
			400,
			{ error: "Invalid payload" },
		]);
	});

	test("uses the timing-safe comparison", async () => {
		const payload = pushPayload(fixture, "main", [
			{ sha: "b".repeat(40), title: "noop" },
		]);
		const response = await delivery(
			app,
			secret,
			"Push Hook",
			payload,
			`${tag}:timing`,
		);
		expect(response.statusCode).toBe(202);
		expect(constantTimeEqual).toHaveBeenCalledWith(secret, secret);
		await waitForDelivery(`${tag}:timing`);
	});
});

describe("webhook delivery", () => {
	test("stores a push with many commits and links only the referenced ones", async () => {
		const commits = Array.from({ length: 25 }, (_, index) => ({
			sha: `${index}`.padStart(40, "d"),
			title:
				index % 5 === 0
					? `${fixture.issueKey} change ${index}`
					: `unrelated change ${index}`,
		}));

		const response = await delivery(
			app,
			secret,
			"Push Hook",
			pushPayload(fixture, `${fixture.issueKey}-many-commits`, commits),
			`${tag}:many`,
		);
		expect(response.statusCode).toBe(202);
		const processed = await waitForDelivery(`${tag}:many`);
		expect(processed.status).toBe("processed");

		const stored = await db
			.select()
			.from(gitlabCommits)
			.where(
				eq(
					gitlabCommits.repositoryId,
					(
						await db
							.select()
							.from(gitlabBranches)
							.where(
								eq(gitlabBranches.name, `${fixture.issueKey}-many-commits`),
							)
					)[0].repositoryId,
				),
			);
		const shas = new Set(commits.map((commit) => commit.sha));
		expect(stored.filter((commit) => shas.has(commit.sha))).toHaveLength(25);

		const development = await issueDevelopment(fixture.issueKey);
		expect(development?.counts.branches).toBe(1);
		expect(development?.counts.commits).toBe(5);
		expect(development?.latestCommit?.title).toContain("change");
	});

	test("rejects a payload over the 5 MB limit", async () => {
		const payload = pushPayload(fixture, "huge", [
			{
				sha: "9".repeat(40),
				title: "huge",
				message: "x".repeat(6 * 1024 * 1024),
			},
		]);
		const response = await delivery(
			app,
			secret,
			"Push Hook",
			payload,
			`${tag}:huge`,
		);
		expect(response.statusCode).toBe(413);
	});

	test("is idempotent on X-Gitlab-Event-UUID", async () => {
		const payload = pushPayload(fixture, "uuid-idempotent", [
			{ sha: "8".repeat(40), title: "uuid" },
		]);
		const uuid = `${tag}:event-uuid`;
		for (const attempt of [1, 2]) {
			const response = await app.inject({
				method: "POST",
				url: "/api/integrations/gitlab/webhook",
				headers: {
					"x-gitlab-token": secret,
					"x-gitlab-event": "Push Hook",
					"x-gitlab-event-uuid": uuid,
					"content-type": "application/json",
				},
				payload: payload as never,
			});
			expect(response.statusCode).toBe(202);
			expect(attempt).toBeLessThanOrEqual(2);
		}
		await waitForDelivery(uuid);
		const rows = await db
			.select()
			.from(gitlabDeliveries)
			.where(eq(gitlabDeliveries.idempotencyKey, uuid));
		expect(rows).toHaveLength(1);
	});

	test("accepts a system hook push whose project has no id", async () => {
		const response = await app.inject({
			method: "POST",
			url: "/api/integrations/gitlab/webhook",
			headers: {
				"x-gitlab-token": secret,
				"x-gitlab-event": "System Hook",
				"x-gitlab-event-uuid": `${tag}:system-push`,
				"content-type": "application/json",
			},
			payload: {
				event_name: "push",
				ref: `refs/heads/${fixture.issueKey}-system`,
				checkout_sha: "7".repeat(40),
				project_id: projectPayload(fixture).id,
				project: {
					name: "service",
					path_with_namespace: `${tag}/service`,
					web_url: `https://gitlab.example.test/${tag}/service`,
				},
				commits: [
					{
						id: "7".repeat(40),
						title: `${fixture.issueKey} system hook`,
						message: `${fixture.issueKey} system hook`,
						timestamp: "2026-05-01T10:00:00+00:00",
						author: { name: "GitLab Tester", email: fixture.userEmail },
					},
				],
			} as never,
		});
		expect(response.statusCode).toBe(202);
		const processed = await waitForDelivery(`${tag}:system-push`);
		expect(processed.status).toBe("processed");
	});

	test("ignores references to issues that do not exist", async () => {
		const before = await issueDevelopment(fixture.issueKey);
		await delivery(
			app,
			secret,
			"Push Hook",
			pushPayload(fixture, "missing-issue", [
				{
					sha: "6".repeat(40),
					title: `${fixture.projectKey}-999 does not exist`,
				},
			]),
			`${tag}:missing`,
		);
		await waitForDelivery(`${tag}:missing`);
		const after = await issueDevelopment(fixture.issueKey);
		expect(after?.counts.commits).toBe(before?.counts.commits);
	});

	test("is idempotent on the GitLab idempotency key", async () => {
		const payload = pushPayload(fixture, "idempotent", [
			{
				sha: "c".repeat(40),
				title: `${fixture.issueKey} first`,
			},
		]);

		const first = await delivery(
			app,
			secret,
			"Push Hook",
			payload,
			`${tag}:idempotent`,
		);
		expect(first.statusCode).toBe(202);
		await waitForDelivery(`${tag}:idempotent`);

		const second = await delivery(
			app,
			secret,
			"Push Hook",
			payload,
			`${tag}:idempotent`,
		);
		expect(second.statusCode).toBe(202);

		const deliveries = await db
			.select()
			.from(gitlabDeliveries)
			.where(eq(gitlabDeliveries.idempotencyKey, `${tag}:idempotent`));
		expect(deliveries).toHaveLength(1);

		const branches = await db
			.select()
			.from(gitlabBranches)
			.where(eq(gitlabBranches.name, "idempotent"));
		expect(branches).toHaveLength(1);
	});

	test("keeps the merge request lifecycle and the dominant state", async () => {
		const branch = `${fixture.issueKey}-mr`;
		const open = await delivery(
			app,
			secret,
			"Merge Request Hook",
			mergeRequestPayload(fixture, {
				iid: 12,
				title: `${fixture.issueKey} add a feature`,
				state: "opened",
				action: "open",
				sourceBranch: branch,
			}),
			`${tag}:mr-open`,
		);
		expect(open.statusCode).toBe(202);
		await waitForDelivery(`${tag}:mr-open`);

		const approved = await delivery(
			app,
			secret,
			"Merge Request Hook",
			mergeRequestPayload(fixture, {
				iid: 12,
				title: `${fixture.issueKey} add a feature`,
				state: "opened",
				action: "approved",
				sourceBranch: branch,
				reviewerState: "approved",
			}),
			`${tag}:mr-approved`,
		);
		expect(approved.statusCode).toBe(202);
		await waitForDelivery(`${tag}:mr-approved`);

		const afterApproval = await db
			.select()
			.from(gitlabMergeRequests)
			.where(eq(gitlabMergeRequests.iid, 12));
		expect(afterApproval[0]?.approvals).toBe(1);
		expect(afterApproval[0]?.state).toBe("opened");
		expect(afterApproval[0]?.reviewers).toHaveLength(1);

		const merged = await delivery(
			app,
			secret,
			"Merge Request Hook",
			mergeRequestPayload(fixture, {
				iid: 12,
				title: `${fixture.issueKey} add a feature`,
				state: "merged",
				action: "merge",
				sourceBranch: branch,
				reviewerState: "approved",
			}),
			`${tag}:mr-merged`,
		);
		expect(merged.statusCode).toBe(202);
		await waitForDelivery(`${tag}:mr-merged`);

		const development = await issueDevelopment(fixture.issueKey);
		expect(development?.counts.mergeRequests).toBe(1);
		expect(development?.mergeRequestState).toBe("MERGED");

		expect(mergeRequestLozenge("opened")).toBe("OPEN");
		expect(mergeRequestLozenge("merged")).toBe("MERGED");
		expect(mergeRequestLozenge("closed")).toBe("DECLINED");
		expect(mergeRequestLozenge("locked")).toBe("MERGED");
		expect(dominantMergeRequestState(["closed", "merged"])).toBe("MERGED");
		expect(dominantMergeRequestState(["closed", "opened", "merged"])).toBe(
			"OPEN",
		);
		expect(dominantMergeRequestState([])).toBeNull();
	});

	test("records a pipeline status for the issue", async () => {
		const response = await delivery(
			app,
			secret,
			"Pipeline Hook",
			pipelinePayload(fixture, {
				id: 901,
				ref: `${fixture.issueKey}-many-commits`,
				sha: `${0}`.padStart(40, "d"),
				status: "success",
			}),
			`${tag}:pipeline`,
		);
		expect(response.statusCode).toBe(202);
		await waitForDelivery(`${tag}:pipeline`);

		const development = await issueDevelopment(fixture.issueKey);
		expect(development?.latestPipeline?.status).toBe("success");
		expect(development?.latestPipeline?.ref).toBe(
			`${fixture.issueKey}-many-commits`,
		);
	});

	test("stores unknown and note events as ignored, not failed", async () => {
		const unknown = await delivery(
			app,
			secret,
			"Issue Hook",
			{ object_kind: "issue", project: {} },
			`${tag}:unknown`,
		);
		expect(unknown.statusCode).toBe(202);
		const unknownDelivery = await waitForDelivery(`${tag}:unknown`);
		expect(unknownDelivery.status).toBe("ignored");
		expect(unknownDelivery.reason).toContain("unknown event");

		const note = await delivery(
			app,
			secret,
			"Note Hook",
			{ object_kind: "note", object_attributes: { note: "hello" } },
			`${tag}:note`,
		);
		expect(note.statusCode).toBe(202);
		const noteDelivery = await waitForDelivery(`${tag}:note`);
		expect(noteDelivery.status).toBe("ignored");

		const tagPush = await delivery(
			app,
			secret,
			"Tag Push Hook",
			{ object_kind: "tag_push", ref: "refs/tags/v1" },
			`${tag}:tag`,
		);
		expect(tagPush.statusCode).toBe(202);
		const tagDelivery = await waitForDelivery(`${tag}:tag`);
		expect(tagDelivery.status).toBe("ignored");
	});
});
