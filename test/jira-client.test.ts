import { describe, expect, test } from "vitest";
import { GetOnlyClient, pathSegment } from "../src/importer/client.ts";
import { JiraClient } from "../src/importer/jira.ts";

test("an id from the remote server cannot leave the attachments directory", () => {
	expect(pathSegment("10432")).toBe("10432");
	expect(pathSegment("att9175-3")).toBe("att9175-3");
	for (const id of ["../../etc/cron.d/x", "a/b", "..", "", "a\\b", "a\0"]) {
		expect(() => pathSegment(id)).toThrow(/unsafe id/);
	}
});

describe("JiraClient", () => {
	test("does not send the token to an address on another host", async () => {
		const calls: string[] = [];
		const client = new JiraClient({
			baseUrl: "https://jira.example.test/jira",
			token: "fixture-token",
			fetchImpl: (async (input: string | URL | Request) => {
				calls.push(String(input));
				return new Response("{}", { status: 200 });
			}) as typeof fetch,
		});

		for (const address of [
			"https://attacker.example.test/secure/attachment/1/a.png",
			"http://jira.example.test/secure/attachment/1/a.png",
			"//attacker.example.test/a.png",
		]) {
			await expect(client.getBytes(address)).rejects.toThrow(
				/refusing to send the access token/,
			);
		}
		expect(calls).toEqual([]);

		await client.getBytes(
			"https://jira.example.test/secure/attachment/1/a.png",
		);
		expect(calls).toHaveLength(1);
	});

	test("refuses every method except GET", async () => {
		const calls: string[] = [];
		const client = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			fetchImpl: (async (input: string | URL | Request) => {
				calls.push(String(input));
				return new Response("{}", { status: 200 });
			}) as typeof fetch,
		});

		for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
			await expect(
				client.request(method, "/rest/api/2/search"),
			).rejects.toThrow(/only allows GET/);
		}
		expect(calls).toEqual([]);
	});

	test("sends the token as a bearer GET request", async () => {
		let authorization: string | undefined;
		const client = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			fetchImpl: (async (
				_input: string | URL | Request,
				init?: RequestInit,
			) => {
				authorization =
					new Headers(init?.headers).get("authorization") ?? undefined;
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			}) as typeof fetch,
		});

		await expect(client.getJson("/rest/api/2/serverInfo")).resolves.toEqual({
			ok: true,
		});
		expect(authorization).toBe("Bearer fixture-token");
	});

	test("rejects a caller-supplied authorization header", async () => {
		let called = false;
		const client = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			fetchImpl: (async () => {
				called = true;
				return new Response("{}", { status: 200 });
			}) as typeof fetch,
		});

		await expect(
			client.getJson("/rest/api/2/serverInfo", undefined, {
				headers: { authorization: "Basic other-credentials" },
			}),
		).rejects.toThrow(/authorization/i);
		expect(called).toBe(false);
	});

	test("still lets a caller ask for another accept type", async () => {
		let accept: string | null = null;
		const client = new JiraClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			fetchImpl: (async (
				_input: string | URL | Request,
				init?: RequestInit,
			) => {
				accept = new Headers(init?.headers).get("accept");
				return new Response("<html></html>", { status: 200 });
			}) as typeof fetch,
		});

		await client.request("GET", "/secure/ManageFilters.jspa", undefined, {
			headers: { Accept: "text/html" },
		});
		expect(accept).toBe("text/html");
	});

	test("rejects options that would deadlock or fail later", () => {
		const options = {
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
		};
		for (const concurrency of [0, -1, 1.5]) {
			expect(() => new GetOnlyClient({ ...options, concurrency })).toThrow(
				/concurrency/,
			);
		}
		for (const maxAttempts of [0, -1, 1.5]) {
			expect(() => new GetOnlyClient({ ...options, maxAttempts })).toThrow(
				/maxAttempts/,
			);
		}
		for (const timeoutMs of [0, -1, Number.NaN]) {
			expect(() => new GetOnlyClient({ ...options, timeoutMs })).toThrow(
				/timeoutMs/,
			);
		}
	});
});

describe("importer request concurrency", () => {
	test("never runs more requests than the configured limit", async () => {
		let firstAttempts = 0;
		let running = 0;
		let peak = 0;
		const client = new GetOnlyClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			concurrency: 1,
			maxAttempts: 2,
			baseDelayMs: 1,
			fetchImpl: (async (input: string | URL | Request) => {
				const path = new URL(String(input)).pathname;
				if (path === "/first" && firstAttempts++ === 0) {
					throw new Error("network error");
				}
				running++;
				peak = Math.max(peak, running);
				await new Promise((resolve) => setTimeout(resolve, 1));
				running--;
				return new Response("{}", { status: 200 });
			}) as typeof fetch,
		});

		const firstRequest = client.getJson("/first");
		const secondRequest = client.getJson("/second");

		await Promise.all([firstRequest, secondRequest]);
		expect(peak).toBe(1);
	});

	test("releases the request slot while waiting to retry", async () => {
		const calls: string[] = [];
		let firstAttempt = () => {};
		const attempted = new Promise<void>((resolve) => {
			firstAttempt = resolve;
		});
		let limitedAttempts = 0;
		let queuedStarted = () => {};
		const queuedAttempted = new Promise<void>((resolve) => {
			queuedStarted = resolve;
		});
		const client = new GetOnlyClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			concurrency: 1,
			maxAttempts: 2,
			baseDelayMs: 200,
			fetchImpl: (async (input: string | URL | Request) => {
				const path = new URL(String(input)).pathname;
				calls.push(path);
				if (path === "/limited" && limitedAttempts++ === 0) {
					firstAttempt();
					return new Response(null, { status: 429 });
				}
				if (path === "/queued") queuedStarted();
				return new Response("{}", { status: 200 });
			}) as typeof fetch,
		});

		const limited = client.getJson("/limited");
		await attempted;
		const started = performance.now();
		const queued = client.getJson("/queued");

		await queuedAttempted;
		const waited = performance.now() - started;
		await Promise.all([limited, queued]);
		expect(calls).toEqual(["/limited", "/queued", "/limited"]);
		expect(waited).toBeLessThan(100);
	});

	test("bounds body downloads as well as request headers", async () => {
		let active = 0;
		let peak = 0;
		const body = () =>
			new ReadableStream(
				{
					async pull(controller) {
						active++;
						peak = Math.max(peak, active);
						await new Promise((resolve) => setTimeout(resolve, 20));
						controller.enqueue(new TextEncoder().encode("{}"));
						controller.close();
						active--;
					},
				},
				{ highWaterMark: 0 },
			);
		const client = new GetOnlyClient({
			baseUrl: "https://jira.example.test",
			token: "fixture-token",
			concurrency: 1,
			fetchImpl: (async () =>
				new Response(body(), {
					status: 200,
					headers: { "content-type": "application/json" },
				})) as typeof fetch,
		});

		await Promise.all([client.getBytes("/one"), client.getBytes("/two")]);
		expect(peak).toBe(1);
	});
});
