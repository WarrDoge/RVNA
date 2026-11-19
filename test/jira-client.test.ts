import { describe, expect, test } from "vitest";
import { pathSegment } from "../src/importer/client.ts";
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
});
