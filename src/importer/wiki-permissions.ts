const SPACE_OPERATIONS = new Set([
	"read",
	"delete_own",
	"restrict",
	"export",
	"delete_mail",
	"administer",
]);

const PAGE_OPERATIONS = new Set(["create", "delete"]);

/**
 * The app has one flat permission set. Confluence splits the same rights by
 * target type: only page create/delete become the app's create/delete; the
 * blog post, comment and attachment rights have no separate app right.
 */
export function mapSpacePermission(
	targetType: string | undefined,
	operationKey: string | undefined,
): string | null {
	if (!targetType || !operationKey) return null;
	if (targetType === "space") {
		return SPACE_OPERATIONS.has(operationKey) ? operationKey : null;
	}
	if (targetType === "page") {
		return PAGE_OPERATIONS.has(operationKey) ? operationKey : null;
	}
	return null;
}

/** A stable label for the skip report when the entry has no app permission. */
export function spacePermissionKey(
	targetType: string | undefined,
	operationKey: string | undefined,
): string {
	return `${targetType ?? "unknown"}:${operationKey ?? "unknown"}`;
}
