import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { adminGroup, buildServer, cleanupTestData, login } from "./helpers.ts";
import type { TestApp } from "./server.ts";

// biome-ignore lint/suspicious/noExplicitAny: test responses are untyped JSON
export type Reply<T = any> = { status: number; body: T };

export type Client = {
	id: string;
	username: string;
	session: string;
	get: (url: string) => Promise<Reply>;
	post: (url: string, payload?: unknown) => Promise<Reply>;
	put: (url: string, payload?: unknown) => Promise<Reply>;
	del: (url: string) => Promise<Reply>;
	raw: (
		method: "POST",
		url: string,
		payload: Buffer,
		contentType: string,
	) => Promise<Reply>;
};

export type TestSpace = { key: string; id: string; homeId: string };

export const doc = (...paragraphs: string[]) => ({
	type: "doc" as const,
	content: paragraphs.map((text) => ({
		type: "paragraph",
		content: [{ type: "text", text }],
	})),
});

export const pageLinkDoc = (title: string, spaceKey?: string) => ({
	type: "doc" as const,
	content: [
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: title,
					marks: [
						{
							type: "link",
							attrs: {
								href: null,
								ref: {
									tag: "ri:page",
									attrs: {
										"ri:content-title": title,
										...(spaceKey ? { "ri:space-key": spaceKey } : {}),
									},
								},
							},
						},
					],
				},
			],
		},
	],
});

export function multipart(file: {
	name: string;
	type: string;
	content: string;
}) {
	const boundary = `----rvna${randomUUID()}`;
	const payload = Buffer.concat([
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
		),
		Buffer.from(file.content),
		Buffer.from(`\r\n--${boundary}--\r\n`),
	]);
	return { payload, contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function setupWiki() {
	const run = randomUUID().slice(0, 8);
	await runMigrations();
	const app = buildServer();
	const upper = run.toUpperCase();
	let counter = 0;

	function client(session: string, id: string, username: string): Client {
		const send = async (
			method: "GET" | "POST" | "PUT" | "DELETE",
			url: string,
			payload?: unknown,
		): Promise<Reply> => {
			const response = await app.inject({
				method,
				url,
				cookies: { sid: session },
				headers: { "x-requested-with": "rvna" },
				payload: payload as never,
			});
			const text = response.body;
			return {
				status: response.statusCode,
				body: text ? JSON.parse(text) : null,
			};
		};
		return {
			id,
			username,
			session,
			get: (url) => send("GET", url),
			post: (url, payload) => send("POST", url, payload),
			put: (url, payload) => send("PUT", url, payload),
			del: (url) => send("DELETE", url),
			raw: async (method, url, payload, contentType) => {
				const response = await app.inject({
					method,
					url,
					cookies: { sid: session },
					headers: {
						"x-requested-with": "rvna",
						"content-type": contentType,
					},
					payload,
				});
				return {
					status: response.statusCode,
					body: response.body ? JSON.parse(response.body) : null,
				};
			},
		};
	}

	async function user(name: string, groups: string[] = []) {
		const username = `t-${run}-${name}`;
		const result = await login(app, {
			sub: `wiki-${run}-${name}`,
			username,
			name: `Wiki ${name}`,
			email: `${username}@example.test`,
			groups,
		});
		const { rows } = await pool.query<{ id: string }>(
			"select id from users where username = $1",
			[username],
		);
		return client(result.sessionId as string, rows[0].id, username);
	}

	const admin = await user("admin", [adminGroup()]);

	async function space(suffix = String(++counter)): Promise<TestSpace> {
		const key = `T${upper}${suffix.toUpperCase()}`;
		const created = await admin.post("/api/wiki/spaces", {
			key,
			name: `Space ${key}`,
		});
		expect(created.status).toBe(201);
		return { key, id: created.body.id, homeId: created.body.homePageId };
	}

	async function grant(
		spaceId: string,
		who: { userId?: string; group?: string; anonymous?: boolean },
		permissions: string[],
	) {
		for (const permission of permissions) {
			await pool.query(
				"insert into space_permissions (source_id, space_id, permission, user_id, group_name, anonymous) values ($1, $2, $3, $4, $5, $6)",
				[
					`fat:test-${randomUUID()}`,
					spaceId,
					permission,
					who.userId ?? null,
					who.group ?? null,
					who.anonymous ?? false,
				],
			);
		}
	}

	async function page(
		client: Client,
		spaceKey: string,
		title: string,
		extra: Record<string, unknown> = {},
	) {
		const created = await client.post("/api/wiki/pages", {
			spaceKey,
			title,
			bodyDoc: doc(`Body of ${title}`),
			...extra,
		});
		expect(created.status).toBe(201);
		return created.body as {
			id: string;
			title: string;
			version: number;
			parentId: string | null;
		};
	}

	async function cleanup() {
		await pool.query("delete from spaces where key like $1", [`T${upper}%`]);
		await cleanupTestData(run);
		await app.close();
	}

	return {
		app: app as TestApp,
		run,
		admin,
		user,
		space,
		grant,
		page,
		cleanup,
	};
}

// biome-ignore lint/suspicious/noExplicitAny: test rows are untyped
export async function rows<T = any>(text: string, params: unknown[] = []) {
	return (await pool.query(text, params)).rows as T[];
}

/** Waits until `count` requests are blocked on a row lock. */
export async function waitForBlockedPages(count: number) {
	for (let attempt = 0; attempt < 300; attempt++) {
		const { rows: waiting } = await pool.query<{ n: string }>(
			`select count(*)::text as n from pg_stat_activity
			 where wait_event_type = 'Lock' and query ilike '%for update%'`,
		);
		if (Number(waiting[0].n) >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting for blocked page locks");
}
