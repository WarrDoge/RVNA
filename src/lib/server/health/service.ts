import { pool } from "../db.ts";

const PROBE_TIMEOUT_MS = 2_000;

export async function health(): Promise<{ status: "ok" | "error" }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			pool.query("select 1"),
			new Promise((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("The database health check timed out")),
					PROBE_TIMEOUT_MS,
				);
			}),
		]);
		return { status: "ok" };
	} catch (error) {
		console.error("Health check failed", error);
		return { status: "error" };
	} finally {
		if (timer) clearTimeout(timer);
	}
}
