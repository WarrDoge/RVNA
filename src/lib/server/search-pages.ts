import type { CurrentUser } from "./auth.ts";
import { searchPages as searchWikiPages } from "./wiki/service.ts";

export interface PageHit {
	id: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	updated: string | null;
}

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
	const result = await searchWikiPages(actor, { query, limit, offset: 0 });
	return {
		total: result.total,
		pages: result.hits.map((hit) => ({
			id: hit.id,
			title: hit.title,
			spaceKey: hit.spaceKey,
			spaceName: hit.spaceName,
			updated: hit.updated,
		})),
	};
}
