import { expect, test } from "vitest";
import { GetOnlyRequestError } from "../src/importer/client.ts";
import { fetchPageSocial } from "../src/importer/wiki-social.ts";

const none = { watchers: [], spaceWatchers: [], likes: [], unexpectedKeys: [] };

test("drafts and trashed pages are not asked, and a 404 counts as none", async () => {
	const calls: string[] = [];
	const client = {
		getJson: async (path: string) => {
			calls.push(path);
			throw new GetOnlyRequestError(404, path);
		},
	};

	expect(await fetchPageSocial(client as never, "1", "draft")).toEqual(none);
	expect(await fetchPageSocial(client as never, "1", "trashed")).toEqual(none);
	expect(calls).toEqual([]);

	expect(
		await fetchPageSocial(client as never, "1", "current", {
			privateApis: true,
		}),
	).toEqual(none);
	expect(calls).toHaveLength(2);
});

test("another failure still stops the import", async () => {
	const client = {
		getJson: async (path: string) => {
			throw new GetOnlyRequestError(500, path);
		},
	};
	await expect(
		fetchPageSocial(client as never, "1", "current", { privateApis: true }),
	).rejects.toThrow("500");
});

test("a page the token cannot see counts as none", async () => {
	const client = {
		getJson: async (path: string) => {
			throw new GetOnlyRequestError(403, path);
		},
	};
	expect(
		await fetchPageSocial(client as never, "1", "current", {
			privateApis: true,
		}),
	).toEqual(none);
});
