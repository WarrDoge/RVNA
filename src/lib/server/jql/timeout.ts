import { sql } from "drizzle-orm";
import { db } from "../db.ts";

export const STATEMENT_TIMEOUT_MS = 15_000;

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Run a query group with a local PostgreSQL statement timeout. */
export function withStatementTimeout<T>(
	run: (tx: Transaction) => Promise<T>,
	timeoutMs = STATEMENT_TIMEOUT_MS,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`set local statement_timeout = ${sql.raw(String(timeoutMs))}`,
		);
		return run(tx);
	});
}
