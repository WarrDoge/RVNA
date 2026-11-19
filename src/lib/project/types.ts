import type { ProjectRef } from "../api-types.ts";

export type ProjectSidebarBoard = {
	id: string;
	rapidViewId: number;
	name: string;
	type: "scrum" | "kanban";
	project: { key: string } | null;
};

export const sidebarActiveValues = [
	"issues",
	"settings",
	"queues",
	"board",
	"backlog",
	"reports",
	"releases",
] as const;

export type SidebarActive = (typeof sidebarActiveValues)[number];

export function isSidebarActive(value: string | null): value is SidebarActive {
	return value !== null && sidebarActiveValues.includes(value as SidebarActive);
}

export type ProjectSidebarQueue = {
	id: string;
	name: string;
	parentId: string | null;
	issueCount: number | null;
	liveCount: number | null;
};

export type ProjectSidebarPortal = {
	id: string;
	name: string;
	projectKey: string;
};

/** Everything the project sidebar renders, loaded by loadProjectSidebar. */
export type ProjectSidebarData = {
	project: ProjectRef;
	archived: boolean;
	boards: ProjectSidebarBoard[];
	canAdminister: boolean;
	user: { isAdmin: boolean };
	queues: ProjectSidebarQueue[];
	portals: ProjectSidebarPortal[];
};
