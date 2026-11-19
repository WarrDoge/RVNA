import type { BoardRef, ProjectRef } from "../../api-types.ts";
import type {
	ProjectSidebarBoard,
	ProjectSidebarData,
	ProjectSidebarPortal,
	ProjectSidebarQueue,
} from "../../project/types.ts";
import { listBoards } from "../agile/service.ts";
import type { CurrentUser } from "../auth.ts";
import { HttpError } from "../http.ts";
import { deskQueues, listPortals } from "../servicedesk/service.ts";
import { getProject } from "./service.ts";

function boardRef(board: BoardRef): ProjectSidebarBoard {
	return {
		id: board.id,
		rapidViewId: board.rapidViewId,
		name: board.name,
		type: board.type,
		project: board.project ? { key: board.project.key } : null,
	};
}

/**
 * A queue the user may not run is an empty list in the sidebar, exactly like the
 * failed query.
 */
async function queuesFor(actor: CurrentUser, projectKey: string) {
	try {
		return (await deskQueues(actor, projectKey)).queues.map((queue) => ({
			id: queue.id,
			name: queue.name,
			parentId: queue.parentId,
			issueCount: queue.issueCount,
			liveCount: queue.liveCount,
		}));
	} catch (error) {
		if (
			error instanceof HttpError &&
			(error.status === 403 || error.status === 404)
		) {
			return [];
		}
		throw error;
	}
}

/**
 * The one prop of the project sidebar: the project, its boards, the settings
 * permission, the viewer, and the service desk navigation for a desk project.
 */
export async function loadProjectSidebar(
	actor: CurrentUser,
	projectKey: string,
	loaded?: Awaited<ReturnType<typeof getProject>>,
): Promise<ProjectSidebarData> {
	const project = loaded ?? (await getProject(actor, projectKey));
	const isDesk = project.type === "service_desk";

	const [boards, queues, portals] = await Promise.all([
		isDesk
			? Promise.resolve([] as BoardRef[])
			: listBoards(actor).then((all) =>
					all
						.filter((board) => board.project?.key === project.key)
						.map(boardRef),
				),
		isDesk
			? queuesFor(actor, project.key)
			: Promise.resolve([] as ProjectSidebarQueue[]),
		isDesk
			? listPortals(actor).then((all) =>
					all.map((portal) => ({
						id: portal.id,
						name: portal.name,
						projectKey: portal.projectKey,
					})),
				)
			: Promise.resolve([] as ProjectSidebarPortal[]),
	]);

	const projectRef: ProjectRef = {
		id: project.id,
		key: project.key,
		name: project.name,
		avatarUrl: project.avatarUrl,
		type: project.type,
	};

	return {
		project: projectRef,
		archived: project.archived,
		boards,
		canAdminister: project.permissions.ADMINISTER_PROJECTS,
		user: { isAdmin: actor.isAdmin },
		queues,
		portals,
	};
}
