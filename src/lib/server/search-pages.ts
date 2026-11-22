import type { CurrentUser } from "./auth.ts";
import type { WikiSearchHit } from "./wiki/search.ts";
import { searchPages as searchWikiPages } from "./wiki/service.ts";

export type PageHit = Pick<
	WikiSearchHit,
	"id" | "title" | "spaceKey" | "spaceName" | "updated"
>;

export interface PageHits {
	total: number;
	pages: PageHit[];
}

/** The permission-filtered wiki search behind the global and quick search. */
export async function searchPages(
	actor: CurrentUser,
	query: string,
	limit: number,
): Promise<PageHits> {
	if (query.trim() === "") return { total: 0, pages: [] };
	const result = await searchWikiPages(actor, { query, limit, offset: 0 });
	return {
		total: result.total,
		pages: result.hits.map(({ id, title, spaceKey, spaceName, updated }) => ({
			id,
			title,
			spaceKey,
			spaceName,
			updated,
		})),
	};
}
