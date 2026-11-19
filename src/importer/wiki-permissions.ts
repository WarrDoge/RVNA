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

export function spacePermissionKey(
	targetType: string | undefined,
	operationKey: string | undefined,
) {
	return `${targetType ?? "unknown"}:${operationKey ?? "unknown"}`;
}
