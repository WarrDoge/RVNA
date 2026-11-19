import { PgBoss } from "pg-boss";
import { env } from "./env.ts";

// One PgBoss per process shared by every job queue; it opens its own pool, so
// the cap keeps app pool + pg-boss + importer inside the role's connection limit.
const POOL_MAX = 4;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
	if (boss) return Promise.resolve(boss);
	starting ??= (async () => {
		const instance = new PgBoss({
			connectionString: env.DATABASE_URL,
			schema: "pgboss",
			max: POOL_MAX,
			application_name: "rvna-queue",
		});
		instance.on("error", (error) => {
			console.error("job queue:", error);
		});
		await instance.start();
		boss = instance;
		return instance;
	})().catch((error) => {
		starting = null;
		throw error;
	});
	return starting;
}

export async function stopBoss() {
	const pending = starting;
	starting = null;
	const instance = boss ?? (await pending?.catch(() => null)) ?? null;
	boss = null;
	await instance?.stop({ graceful: true, close: true, timeout: 5_000 });
}
