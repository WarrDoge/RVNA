import { pool } from "./db.ts";
import { rebuildSlaCycles } from "./sla/rebuild.ts";

try {
	const result = await rebuildSlaCycles();
	console.log(`sla rebuild: ${result.issues} issues, ${result.cycles} cycles`);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	await pool.end();
}
