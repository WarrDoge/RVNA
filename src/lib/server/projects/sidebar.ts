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
import { canRaiseRequests, deskByProjectId } from "../servicedesk/access.ts";
import { deskQueues } from "../servicedesk/service.ts";
import { getProject } from "./service.ts";

type LoadedProject = Awaited<ReturnType<typeof getProject>>;
type SidebarProject = Pick<
	LoadedProject,
	"id" | "key" | "name" | "avatarUrl" | "type" | "archived" | "permissions"
>;

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

/** The current project's portal, when the viewer may raise requests there. */
async function portalFor(
	actor: CurrentUser,
	projectId: string,
): Promise<ProjectSidebarPortal[]> {
	const desk = await deskByProjectId(projectId);
	if (!desk || !(await canRaiseRequests(actor, desk))) return [];
	return [{ id: desk.id, name: desk.portalName, projectKey: desk.projectKey }];
}

/**
 * The one prop of the project sidebar: the project, its boards, the settings
 * permission, the viewer, and the service desk navigation for a desk project.
 */
export async function loadProjectSidebar(
	actor: CurrentUser,
	projectKey: string,
	loaded?: SidebarProject,
): Promise<ProjectSidebarData> {
	const project = loaded ?? (await getProject(actor, projectKey));
	const isDesk = project.type === "service_desk";

	const [boards, queues, portals] = await Promise.all([
		isDesk
			? Promise.resolve([] as BoardRef[])
			: listBoards(actor, { projectId: project.id }).then((all) =>
					all.map(boardRef),
				),
		isDesk
			? queuesFor(actor, project.key)
			: Promise.resolve([] as ProjectSidebarQueue[]),
		isDesk
			? portalFor(actor, project.id)
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
