import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, test } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";

const unreachableDatabase = "postgres://rvna:rvna@127.0.0.1:1/unreachable";

function cliEnv(overrides: Record<string, string | undefined> = {}) {
	const env = { ...process.env };
	for (const name of [
		"JIRA_URL",
		"JIRA_PAT",
		"CONFLUENCE_URL",
		"CONFLUENCE_PAT",
	]) {
		delete env[name];
	}
	return { ...env, ...overrides };
}

function runCli(args: string[], env: Record<string, string | undefined>) {
	return spawnSync(process.execPath, ["src/importer/main.ts", ...args], {
		cwd: process.cwd(),
		env: cliEnv(env),
		encoding: "utf8",
		timeout: 20_000,
	});
}

beforeAll(async () => {
	await runMigrations();
});

describe("importer command options", () => {
	test.each([
		["jira-avatars", "--space", "WEB"],
		["jira-avatars", "--skip-attachments"],
		["jira-avatars", "--app-url", "https://app.example.test"],
		["jira-avatars", "--app-token", "fixture-token"],
		["jira-agile-local", "--overwrite-local"],
		["jira-agile-local", "--private-apis"],
		["jira-permissions", "--private-apis"],
		["confluence-groups", "--private-apis"],
	])("rejects %s %s", (...args) => {
		const result = runCli(args, {
			DATABASE_URL: unreachableDatabase,
		});

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Usage:");
	});

	test("still accepts the options a command uses", () => {
		const result = runCli(["jira-permissions", "--project", "DEMO"], {
			DATABASE_URL: unreachableDatabase,
		});

		expect(result.stderr).not.toContain("Usage:");
	});
});

describe("parity command reporting", () => {
	test("uses the parsed command for the error exit code", () => {
		const result = runCli(["--json", "parity"], {
			DATABASE_URL: process.env.DATABASE_URL,
		});

		expect(result.status).toBe(2);
		expect(result.stdout).toContain("JIRA_URL is required");
	});

	test("reports a missing schema instead of a relation error", async () => {
		const schema = `parity_empty_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
		await pool.query(`create schema ${schema}`);
		try {
			const url = new URL(process.env.DATABASE_URL ?? "");
			url.searchParams.set("options", `-c search_path=${schema}`);
			const result = runCli(["parity", "jira"], {
				DATABASE_URL: url.toString(),
				JIRA_URL: "https://jira.example.test",
				JIRA_PAT: "fixture-token",
			});

			expect(result.status).toBe(2);
			expect(result.stderr).toMatch(/schema is missing/i);
			expect(result.stderr).not.toContain('relation "projects"');
		} finally {
			await pool.query(`drop schema ${schema} cascade`);
		}
	});
});
