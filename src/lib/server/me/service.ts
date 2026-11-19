import type { CurrentUser } from "../auth.ts";

export type Me = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	groups: string[];
	isAdmin: boolean;
	mustChangePassword: boolean;
	hasPassword: boolean;
};

export function me(actor: CurrentUser): Me {
	return {
		id: actor.id,
		username: actor.username,
		displayName: actor.displayName,
		email: actor.email,
		avatarUrl: actor.avatarUrl,
		groups: actor.groups,
		isAdmin: actor.isAdmin,
		mustChangePassword: actor.mustChangePassword,
		hasPassword: actor.hasPassword,
	};
}
