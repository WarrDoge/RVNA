import type { Profile } from "#lib/api-types.ts";

export function profileJql(user: Pick<Profile, "isSelf" | "username">) {
	const assignee = user.isSelf
		? "currentUser()"
		: `"${user.username.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
	return `assignee = ${assignee} AND resolution = Unresolved`;
}
