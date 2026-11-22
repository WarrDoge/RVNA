import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";
import { can } from "../src/lib/server/permissions.ts";

test("a permission load that failed is retried for the next check", async () => {
	await runMigrations();
	const user = {
		id: randomUUID(),
		username: "cache-probe",
		groups: [],
		isAdmin: false,
	};
	const project = { id: randomUUID(), key: "CACHE", leadId: null };
	const original = pool.query.bind(pool);
	let failed = false;
	(pool as unknown as { query: typeof pool.query }).query = ((
		query: { text?: string } | string,
		...rest: unknown[]
	) => {
		const text = typeof query === "string" ? query : (query.text ?? "");
		if (!failed && text.includes('from "permission_schemes"')) {
			failed = true;
			return Promise.reject(new Error("permission load failed"));
		}
		return (original as (...args: unknown[]) => unknown)(query, ...rest);
	}) as typeof pool.query;
	try {
		await expect(can(user, "BROWSE_PROJECTS", project)).rejects.toThrow();
		await expect(can(user, "BROWSE_PROJECTS", project)).resolves.toBe(true);
	} finally {
		(pool as unknown as { query: typeof pool.query }).query = original;
	}
});
