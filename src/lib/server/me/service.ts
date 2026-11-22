import type { CurrentUser } from "../auth.ts";

export type Me = CurrentUser;

export function me(actor: CurrentUser): Me {
	return { ...actor, groups: [...actor.groups] };
}
