import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { MIGRATION_LOCK } from "../lib/server/db.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

export const pool = new pg.Pool({ connectionString: databaseUrl });
export const db = drizzle(pool);

pool.on("error", (error) => {
	console.error(error);
});

/** Takes the lock the server takes, so an import and a starting server never migrate together. */
export async function runMigrations() {
	const client = await pool.connect();
	let failed = false;
	let unlockError: unknown;
	try {
		await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
		await migrate(drizzle(client), {
			migrationsFolder: resolve("drizzle"),
		});
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		let unlocked = false;
		try {
			await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
			unlocked = true;
		} catch (error) {
			unlockError = error;
		}
		if (failed || !unlocked) client.release(true);
		else client.release();
	}
	if (unlockError) throw unlockError;
}
