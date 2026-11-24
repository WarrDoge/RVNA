import { and, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { userWithEmailSchema } from "./api-schemas.ts";
import type { CurrentUser } from "./auth.ts";
import { userAvatarSql } from "./avatars.ts";
import { db } from "./db.ts";
import { visibleUsersFilter } from "./permissions.ts";
import { users } from "./schema.ts";

export const userListSchema = z.array(userWithEmailSchema);

export type UserListEntry = z.infer<typeof userWithEmailSchema>;

const USER_SEARCH_LIMIT = 20;

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

	const scope = await visibleUsersFilter(user);

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
