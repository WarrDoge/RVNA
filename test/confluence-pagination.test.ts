import { describe, expect, test } from "vitest";
import { ConfluenceClient } from "../src/importer/confluence.ts";

const baseUrl = "https://confluence.example.test";

function clientFor(fetchImpl: typeof fetch) {
	return new ConfluenceClient({
		baseUrl,
		token: "fixture-token",
		fetchImpl,
	});
}

describe("Confluence pagination", () => {
	test("follows the next link when an endpoint caps the page size", async () => {
		const starts: number[] = [];
		const client = clientFor((async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const start = Number(url.searchParams.get("start"));
			starts.push(start);
			if (start === 0) {
				return Response.json({
					results: [
						{ id: "1", key: "ONE" },
						{ id: "2", key: "TWO" },
					],
					start: 0,
					limit: 100,
					size: 2,
					_links: { next: `${baseUrl}/rest/api/space?start=2&limit=100` },
				});
			}
			return Response.json({
				results: [{ id: "3", key: "THREE" }],
				start: 2,
				limit: 100,
				size: 1,
				_links: {},
			});
		}) as typeof fetch);

		const spaces = await client.listSpaces("current");
		expect(spaces.map((space) => space.key)).toEqual(["ONE", "TWO", "THREE"]);
		expect(starts).toEqual([0, 2]);
	});

	test("continues after a short page when there is no next link", async () => {
		const starts: number[] = [];
		const client = clientFor((async (input: string | URL | Request) => {
			const url = new URL(String(input));
			const start = Number(url.searchParams.get("start"));
			starts.push(start);
			if (start === 0) {
				return Response.json({
					results: [
						{ id: "1", key: "ONE" },
						{ id: "2", key: "TWO" },
					],
					start: 0,
					limit: 100,
					size: 2,
				});
			}
			if (start === 2) {
				return Response.json({
					results: [{ id: "3", key: "THREE" }],
					start: 2,
					limit: 100,
					size: 1,
				});
			}
			return Response.json({ results: [], start, limit: 100, size: 0 });
		}) as typeof fetch);

		const spaces = await client.listSpaces("current");
		expect(spaces.map((space) => space.key)).toEqual(["ONE", "TWO", "THREE"]);
		expect(starts).toEqual([0, 2, 3]);
	});

	test("treats a response without results as an empty page", async () => {
		const client = clientFor((async () =>
			Response.json({ size: 0 })) as typeof fetch);

		await expect(client.listSpaces("current")).resolves.toEqual([]);
	});

	test("attachment and content versions read the same endpoint", async () => {
		const paths: string[] = [];
		const client = clientFor((async (input: string | URL | Request) => {
			paths.push(new URL(String(input)).pathname);
			return Response.json({ results: [] });
		}) as typeof fetch);

		await expect(client.listAttachmentVersions("42")).resolves.toEqual([]);
		await expect(client.listVersions("42")).resolves.toEqual([]);
		expect(paths).toEqual([
			"/rest/experimental/content/42/version",
			"/rest/experimental/content/42/version",
		]);
	});
});
