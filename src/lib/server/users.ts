import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { userWithEmailSchema } from "./api-schemas.ts";
import type { CurrentUser } from "./auth.ts";
import { userAvatarSql } from "./avatars.ts";
import { db } from "./db.ts";
import { visibleUsernames } from "./permissions.ts";
import { users } from "./schema.ts";

export const userListSchema = z.array(userWithEmailSchema);

export type UserListEntry = z.infer<typeof userWithEmailSchema>;

const USER_SEARCH_LIMIT = 20;

/**
 * Whom a signed-in user may find: the people who can browse a project the user can browse
 * (`visibleUsernames`), the people who can read a wiki space the user can read, and the user.
 * A space's anonymous read grant is about visitors who are not signed in, so it counts for
 * nobody. Administrators see everyone and skip this filter.
 */
async function visibleToUser(user: CurrentUser) {
	const usernames = [...(await visibleUsernames(user)), user.username];
	const groups = user.groups.map((name) => name.toLowerCase());
	return or(
		sql`${users.username} = any(${sql.param(usernames)}::text[])`,
		sql`exists (
			select 1
			from space_permissions mine
			join space_permissions theirs on theirs.space_id = mine.space_id
			where mine.permission in ('read', 'administer')
				and theirs.permission in ('read', 'administer')
				and (
					mine.user_id = ${user.id}
					or lower(mine.group_name) = any(${sql.param(groups)}::text[])
				)
				and (
					theirs.user_id = ${users.id}
					or exists (
						select 1
						from user_groups ug
						join groups g on g.id = ug.group_id
						where ug.user_id = ${users.id}
							and lower(g.name) = lower(theirs.group_name)
					)
				)
		)`,
	);
}

export async function searchUsers(
	user: CurrentUser,
	query: string,
): Promise<UserListEntry[]> {
	const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
	const match =
		query === ""
			? undefined
			: or(
					ilike(users.displayName, pattern),
					ilike(users.username, pattern),
					...(user.isAdmin ? [ilike(users.email, pattern)] : []),
				);

	const scope = user.isAdmin ? undefined : await visibleToUser(user);

	const rows = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: userAvatarSql(users.id),
			...(user.isAdmin ? { email: users.email } : {}),
		})
		.from(users)
		.where(and(eq(users.active, true), match, scope))
		.orderBy(sql`lower(${users.displayName})`, users.username)
		.limit(USER_SEARCH_LIMIT);

	return rows;
}
