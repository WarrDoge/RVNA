import { randomUUID } from "node:crypto";
import type { db } from "./db.ts";
import { issueHistory, issueHistoryItems } from "./schema.ts";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Must be the caller's transaction: the header and its items are written together. */
export type Executor = Transaction;

export type HistoryItem = {
	field: string;
	fieldType: string | null;
	fromValue: string | null;
	fromText: string | null;
	toValue: string | null;
	toText: string | null;
};

export async function writeHistory(
	tx: Executor,
	issueId: string,
	authorId: string | null,
	items: HistoryItem[],
	via: string | null = null,
) {
	if (items.length === 0) return;
	const [entry] = await tx
		.insert(issueHistory)
		.values({
			sourceId: `local:${randomUUID()}`,
			issueId,
			authorId,
			created: new Date(),
			via,
		})
		.returning();
	await tx.insert(issueHistoryItems).values(
		items.map((item, sequence) => ({
			sourceId: null,
			historyId: entry.id,
			field: item.field,
			fieldType: item.fieldType,
			fromValue: item.fromValue,
			fromText: item.fromText,
			toValue: item.toValue,
			toText: item.toText,
			sequence,
		})),
	);
}
