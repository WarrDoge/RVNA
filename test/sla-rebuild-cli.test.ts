import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

test("a rebuild without a database reports one error, not a shutdown failure", () => {
	const env = { ...process.env };
	delete env.DATABASE_URL;
	const result = spawnSync(
		process.execPath,
		["src/lib/server/sla-rebuild.ts"],
		{
			cwd: process.cwd(),
			env,
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	const output = `${result.stdout}${result.stderr}`;
	expect(output.match(/DATABASE_URL is required/g) ?? []).toHaveLength(1);
	expect(output).not.toContain("at getPool");
	expect(result.status).toBe(1);
});
