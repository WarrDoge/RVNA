import type { UserRef } from "#lib/api-types.ts";

export type ProjectType = "software" | "service_desk";

export type ProjectSummary = {
	id: string;
	key: string;
	name: string;
	type: ProjectType;
	avatarUrl: string | null;
	lead: UserRef | null;
	issueCount: number;
	archived: boolean;
};

export type MeRef = {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
};
