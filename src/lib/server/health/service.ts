import { pool } from "../db.ts";

export async function health(): Promise<{ status: "ok" | "error" }> {
	try {
		await pool.query("select 1");
		return { status: "ok" };
	} catch {
		return { status: "error" };
	}
}
