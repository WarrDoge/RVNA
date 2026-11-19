import { getBoard } from "#lib/server/agile/service.ts";
import { boardRef, loadBoardSidebar } from "#lib/server/boards/sidebar.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { listProjectReleases } from "#lib/server/reports/service.ts";
import type { PageServerLoad } from "./$types";

function notFound(error: unknown) {
	return isHttpError(error) && error.status === 404;
}

export const load = pageLoad(async (event, actor) => {
	const rapidViewId = Number(event.params.rapidViewId);
	if (!Number.isInteger(rapidViewId) || rapidViewId <= 0) {
		return {
			missing: true as const,
			board: null,
			sidebar: null,
			releases: null,
			releasesError: null,
		};
	}

	let board: Awaited<ReturnType<typeof getBoard>>;
	try {
		board = await getBoard(actor, rapidViewId);
	} catch (error) {
		if (notFound(error)) {
			return {
				missing: true as const,
				board: null,
				sidebar: null,
				releases: null,
				releasesError: null,
			};
		}
		throw error;
	}

	event.depends("app:releases");

	const releasesPromise = board.project
		? listProjectReleases(actor, board.project.key)
				.then((value) => ({ value, error: null }))
				.catch((error: unknown) => {
					if (isHttpError(error)) return { value: null, error: error.message };
					throw error;
				})
		: Promise.resolve({ value: null, error: null });

	const ref = boardRef(board);
	const [sidebar, releases] = await Promise.all([
		loadBoardSidebar(actor, ref),
		releasesPromise,
	]);

	return {
		missing: false as const,
		board: ref,
		sidebar,
		releases: releases.value,
		releasesError: releases.error,
	};
}) satisfies PageServerLoad;
