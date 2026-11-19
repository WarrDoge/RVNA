import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { type CurrentUser, effectiveGroups } from "./auth.ts";
import { userAvatarUrl } from "./avatars.ts";
import { db } from "./db.ts";
import { HttpError } from "./http.ts";
import { viewerProjectIds } from "./permissions.ts";
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

export async function userProfile(
	viewer: CurrentUser,
	username: string,
): Promise<UserProfile> {
	const [user] = await db
		.select({
			id: users.id,
			username: users.username,
			displayName: users.displayName,
			email: users.email,
			messengerMatrixId: users.messengerMatrixId,
		})
		.from(users)
		.where(eq(users.username, username))
		.limit(1);
	if (!user) throw new HttpError(404, "User not found");

	const memberships =
		viewer.isAdmin || viewer.id === user.id
			? await effectiveGroups(user.id)
			: [];

	const [preferences] = await db
		.select({ timeZone: userPreferences.timeZone })
		.from(userPreferences)
		.where(eq(userPreferences.userId, user.id))
		.limit(1);

	const [assigned] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(issues)
		.where(
			and(
				eq(issues.assigneeId, user.id),
				isNull(issues.resolutionId),
				inArray(issues.projectId, await viewerProjectIds(viewer)),
			),
		);

	return {
		id: user.id,
		username: user.username,
		displayName: user.displayName,
		email: viewer.isAdmin || viewer.id === user.id ? user.email : null,
		avatarUrl: userAvatarUrl(user.id),
		groups: memberships,
		timeZone: preferences?.timeZone ?? null,
		assignedOpenIssues: assigned?.count ?? 0,
		isSelf: viewer.id === user.id,
		canEditAvatar: viewer.id === user.id || viewer.isAdmin,
		messengerMatrixId: viewer.id === user.id ? user.messengerMatrixId : null,
	};
}
