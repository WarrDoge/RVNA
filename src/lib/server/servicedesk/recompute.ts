import { rebuildSlaCycles } from "../sla/rebuild.ts";

/**
 * Recomputes the SLA cycles of one issue after a write that changes them.
 * Only issues of a service desk project have cycles; the rebuild ignores the
 * rest. A broken SLA configuration is logged instead of failing the write.
 */
export async function recomputeIssueSla(issueId: string): Promise<void> {
	try {
		await rebuildSlaCycles({ issueIds: [issueId] });
	} catch (error) {
		console.error(`SLA recompute failed for issue ${issueId}`, error);
	}
}
