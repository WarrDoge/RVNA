import type { CurrentUser } from "../auth.ts";
import { type getPage, getSpaceTree } from "./service.ts";

type PageDetail = Awaited<ReturnType<typeof getPage>>;

/** The page fields a wiki screen needs for the frame and its breadcrumbs. */
export function readPageMeta(page: PageDetail) {
	return {
		id: page.id,
		sourceId: page.sourceId,
		title: page.title,
		space: {
			key: page.space.key,
			name: page.space.name,
			iconPath: page.space.iconPath,
		},
		ancestors: page.ancestors,
	};
}

export type ReadPageMeta = ReturnType<typeof readPageMeta>;

/**
 * A page and the tree of its space, loaded side by side when the address names the space.
 * When the page lives in another space than the address says, the tree is read again for the
 * page's own space.
 */
export async function loadPageWithTree(
	actor: CurrentUser,
	spaceKey: string,
	loadPage: () => Promise<PageDetail>,
) {
	const [pageResult, treeResult] = await Promise.allSettled([
		loadPage(),
		getSpaceTree(actor, spaceKey),
	]);
	if (pageResult.status === "rejected") throw pageResult.reason;
	const page = pageResult.value;
	if (
		treeResult.status === "fulfilled" &&
		page.space.key.toLowerCase() === spaceKey.toLowerCase()
	) {
		return { page, tree: treeResult.value };
	}
	return { page, tree: await getSpaceTree(actor, page.space.key) };
}
