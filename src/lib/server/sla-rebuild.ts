import { pool } from "./db.ts";
import { rebuildSlaCycles } from "./sla/rebuild.ts";

let reported = false;
try {
	const result = await rebuildSlaCycles();
	console.log(`sla rebuild: ${result.issues} issues, ${result.cycles} cycles`);
} catch (error) {
	reported = true;
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
} finally {
	try {
		await pool.end();
	} catch (error) {
		// The rebuild may fail before the pool exists; its error was already reported.
		if (!reported) {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	}
}
