import { PgBoss } from "pg-boss";
import { env } from "./env.ts";

// One PgBoss per process shared by every job queue; it opens its own pool, so
// the cap keeps app pool + pg-boss + importer inside the role's connection limit.
const POOL_MAX = 4;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;
let stopping: Promise<void> | null = null;

async function startBoss(): Promise<PgBoss> {
	const instance = new PgBoss({
		connectionString: env.DATABASE_URL,
		schema: "pgboss",
		max: POOL_MAX,
		application_name: "rvna-queue",
	});
	instance.on("error", (error) => {
		console.error("job queue:", error);
	});
	try {
		await instance.start();
	} catch (error) {
		// start() may have opened the pool before it failed.
		await instance.stop({ close: true }).catch((stopError) => {
			console.error("job queue: close after a failed start", stopError);
		});
		throw error;
	}
	boss = instance;
	return instance;
}

export function getBoss(): Promise<PgBoss> {
	if (boss) return Promise.resolve(boss);
	if (stopping) return stopping.then(() => getBoss());
	let pending = starting;
	if (!pending) {
		pending = startBoss();
		starting = pending;
		const clear = () => {
			if (starting === pending) starting = null;
		};
		void pending.then(clear, clear);
	}
	return pending;
}

export async function stopBoss() {
	if (stopping) return stopping;
	const pending = starting;
	starting = null;
	const stop = (async () => {
		const instance = boss ?? (await pending?.catch(() => null)) ?? null;
		boss = null;
		await instance?.stop({ graceful: true, close: true, timeout: 5_000 });
	})();
	stopping = stop;
	try {
		await stop;
	} finally {
		if (stopping === stop) stopping = null;
	}
}
