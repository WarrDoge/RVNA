import type { CurrentUser } from "../auth.ts";
import type { db } from "../db.ts";
import { auditLog } from "../schema-admin.ts";

type Executor = Pick<typeof db, "insert">;

export type AuditEntry = {
	action: string;
	entityType: string;
	entityId?: string | null;
	summary: string;
	changes?: { from?: unknown; to?: unknown } | null;
};

/** Pass the transaction of the change so the audit row commits or rolls back with it. */
export async function audit(
	executor: Executor,
	actor: CurrentUser,
	entry: AuditEntry,
) {
	await executor.insert(auditLog).values({
		actorId: actor.id,
		actorName: actor.displayName,
		action: entry.action,
		entityType: entry.entityType,
		entityId: entry.entityId ?? null,
		summary: entry.summary,
		changes: entry.changes ?? null,
	});
}
