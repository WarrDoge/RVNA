import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type CurrentUser, effectiveGroups } from "./auth.ts";
import { userAvatarUrl } from "./avatars.ts";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";
import { viewerProjectIds, visibleUsersFilter } from "./permissions.ts";
import { issues, userPreferences, users } from "./schema.ts";

export const profileSchema = z.object({
	id: z.uuid(),
	username: z.string(),
	displayName: z.string(),
	email: z.string().nullable(),
	avatarUrl: z.string(),
	groups: z.array(z.string()),
	timeZone: z.string().nullable(),
	assignedOpenIssues: z.number().int(),
	isSelf: z.boolean(),
	canEditAvatar: z.boolean(),
	messengerMatrixId: z.string().nullable(),
});

export type UserProfile = z.infer<typeof profileSchema>;

/** A user the viewer may not see answers like a user that does not exist. */
export async function userProfile(
	viewer: CurrentUser,
	username: string,
): Promise<UserProfile> {
	const scope = await visibleUsersFilter(viewer);
	const [user] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			email: users.email,
			messengerMatrixId: users.messengerMatrixId,
		})
		.from(users)
		.where(and(eq(users.username, username), eq(users.active, true), scope))
		.limit(1);
	if (!user) throw new HttpError(404, "User not found");

	const self = viewer.id === user.id;
	const memberships =
		viewer.isAdmin || self ? effectiveGroups(user.id) : Promise.resolve([]);
	const preferences = db
		.select({ timeZone: userPreferences.timeZone })
		.from(userPreferences)
		.where(eq(userPreferences.userId, user.id))
		.limit(1);
	const assigned = (async () => {
		const [row] = await db
			.select({ count: sql<number>`count(*)::int` })
			.from(issues)
			.where(
				and(
					eq(issues.assigneeId, user.id),
					isNull(issues.resolutionId),
					inArray(issues.projectId, await viewerProjectIds(viewer)),
				),
			);
		return row;
	})();

	const [groups, [preference], openIssues] = await Promise.all([
		memberships,
		preferences,
		assigned,
	]);

	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		email: viewer.isAdmin || self ? user.email : null,
		avatarUrl: userAvatarUrl(user.id),
		groups,
		timeZone: preference?.timeZone ?? null,
		assignedOpenIssues: openIssues?.count ?? 0,
		isSelf: self,
		canEditAvatar: self || viewer.isAdmin,
		messengerMatrixId: self ? user.messengerMatrixId : null,
	};
}
