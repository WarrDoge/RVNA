import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { readPageMeta } from "#lib/server/wiki/read.ts";
import {
	diffPageVersions,
	getPage,
	getSpaceTree,
} from "#lib/server/wiki/service.ts";
import type { PageServerLoad } from "./$types";

export const load = pageLoad(async (event, actor) => {
	const pageId = event.url.searchParams.get("pageId") ?? "";
	const versions = event.url.searchParams
		.getAll("selectedPageVersions")
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value));
	const from = versions[0];
	const to = versions[1];
	event.depends("app:wiki-page");

	if (pageId === "") {
		return {
			page: null,
			tree: [],
			diff: null,
			from: null,
			to: null,
			missing: true,
		};
	}

	let page: Awaited<ReturnType<typeof getPage>>;
	let tree: Awaited<ReturnType<typeof getSpaceTree>>;
	try {
		page = await getPage(actor, pageId);
		tree = await getSpaceTree(actor, page.space.key);
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: null,
				tree: [],
				diff: null,
				from: null,
				to: null,
				missing: true,
			};
		}
		throw cause;
	}

	if (from === undefined || to === undefined) {
		return {
			page: readPageMeta(page),
			tree,
			diff: null,
			from: null,
			to: null,
			missing: false,
		};
	}

	try {
		const diff = await diffPageVersions(actor, page.id, from, to);
		return {
			page: readPageMeta(page),
			tree,
			diff,
			from,
			to,
			missing: false,
		};
	} catch (cause) {
		if (isHttpError(cause)) {
			return {
				page: readPageMeta(page),
				tree,
				diff: null,
				from,
				to,
				missing: false,
			};
		}
		throw cause;
	}
}) satisfies PageServerLoad;
