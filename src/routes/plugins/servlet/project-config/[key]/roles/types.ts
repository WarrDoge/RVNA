export type ProjectRoleActor = {
	id: string;
	actorType: "user" | "group";
	parameter: string;
	displayName: string;
	source: "imported" | "local";
};

export type ProjectRole = {
	id: string;
	name: string;
	actors: ProjectRoleActor[];
	permissions: string[];
};

export type ProjectRolesData = {
	project: { id: string; key: string; name: string };
	scheme: {
		id: string | null;
		name: string;
		source: "imported" | "local" | "default";
	};
	roles: ProjectRole[];
	groups: { id: string; name: string; local: boolean }[];
};
