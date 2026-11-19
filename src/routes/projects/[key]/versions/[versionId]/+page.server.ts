import { z } from "zod";
import type { ProjectSidebarData } from "#lib/project/types.ts";
import { isHttpError } from "#lib/server/http.ts";
import { pageLoad } from "#lib/server/http-svelte.ts";
import { loadProjectSidebar } from "#lib/server/projects/sidebar.ts";
import { getProjectVersion } from "#lib/server/reports/service.ts";
import type { PageServerLoad } from "./$types";

function settle<T>(result: PromiseSettledResult<T>): T | null {
	if (result.status === "fulfilled") return result.value;
	if (isHttpError(result.reason) && result.reason.status === 404) return null;
	throw result.reason;
}

const versionParams = z.object({ versionId: z.uuid() });

export const load = pageLoad(async (event, actor) => {
	if (!versionParams.safeParse(event.params).success) {
		return { payload: null, sidebar: null };
	}
	const [versionResult, sidebarResult] = await Promise.allSettled([
		getProjectVersion(actor, event.params.key, event.params.versionId),
		loadProjectSidebar(actor, event.params.key),
	]);

	const payload = settle(versionResult);
	const sidebar: ProjectSidebarData | null = settle(sidebarResult);

	return {
		payload,
		sidebar: payload ? sidebar : null,
	};
}) satisfies PageServerLoad;
