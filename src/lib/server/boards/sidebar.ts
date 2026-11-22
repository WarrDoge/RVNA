import type { BoardConfig, BoardRef } from "../../api-types.ts";
import type { ProjectSidebarData } from "../../project/types.ts";
import type { CurrentUser } from "../auth.ts";
import { loadProjectSidebar } from "../projects/sidebar.ts";

/** The fields of a board that the shell and the sidebar render. */
export function boardRef(board: BoardConfig): BoardRef {
	return {
		id: board.id,
		rapidViewId: board.rapidViewId,
		name: board.name,
		type: board.type,
		project: board.project,
		owner: board.owner,
		configImported: board.configImported,
	};
}

/**
 * The sidebar data of a board page; a board without a project renders board-only.
 * That placeholder project has the board's id and an empty key, so consumers must
 * check `project.key` before treating it as a real project.
 */
export async function loadBoardSidebar(
	actor: CurrentUser,
	board: BoardRef,
): Promise<ProjectSidebarData> {
	if (board.project) {
		return loadProjectSidebar(actor, board.project.key);
	}
	return {
		project: {
			id: board.id,
			key: "",
			name: board.name,
			avatarUrl: null,
			type: "software",
		},
		archived: false,
		boards: [board],
		canAdminister: false,
		user: { isAdmin: actor.isAdmin },
		queues: [],
		portals: [],
	};
}
