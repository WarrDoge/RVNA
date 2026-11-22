import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

let poolInstance: pg.Pool | undefined;
type Database = NodePgDatabase<Record<string, never>> & { $client: pg.Pool };

let dbInstance: Database | undefined;

function getPool() {
	if (!poolInstance) {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) throw new Error("DATABASE_URL is required");
		poolInstance = new pg.Pool({ connectionString: databaseUrl, max: 10 });
		poolInstance.on("error", (error) => {
			console.error(error);
		});
	}
	return poolInstance;
}

function getDb(): Database {
	dbInstance ??= drizzle(getPool());
	return dbInstance;
}

function proxy<T extends object>(target: () => T): T {
	return new Proxy({} as T, {
		get(_object, property) {
			const value = Reflect.get(target(), property);
			return typeof value === "function" ? value.bind(target()) : value;
		},
		set(_object, property, value) {
			return Reflect.set(target(), property, value);
		},
		has(_object, property) {
			return property in target();
		},
		ownKeys() {
			return Reflect.ownKeys(target());
		},
		getOwnPropertyDescriptor(_object, property) {
			return Reflect.getOwnPropertyDescriptor(target(), property);
		},
	});
}

export const pool = proxy(getPool);
export const db = proxy(getDb);

/** The migrations sit next to the source tree, whatever the process working directory is. */
const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../../drizzle", import.meta.url),
);

/** One lock shared by every process that migrates this database. */
export const MIGRATION_LOCK = 7_203_117_042;

export async function runMigrations() {
	// Drizzle reads the journal and runs pending migrations outside our transaction, so the
	// lock has to live on a dedicated session: a transaction-scoped lock would not cover it.
	// The migration runs on that same session: a second pool connection could never be had
	// when every other connection waits for the lock.
	const client = await getPool().connect();
	try {
		await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
		await migrate(drizzle(client), {
			migrationsFolder: MIGRATIONS_FOLDER,
		});
	} finally {
		try {
			await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]);
		} finally {
			client.release();
		}
	}
}
