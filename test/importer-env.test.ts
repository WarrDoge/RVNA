import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
	vi.resetModules();
	vi.unstubAllEnvs();
});

test("empty optional values are treated as unset", async () => {
	vi.stubEnv("JIRA_URL", "");
	vi.stubEnv("JIRA_PAT", "");
	vi.stubEnv("CONFLUENCE_URL", "");
	vi.stubEnv("CONFLUENCE_PAT", "");
	vi.stubEnv("ATTACHMENTS_DIR", "");
	vi.stubEnv("AVATARS_DIR", "");

	const { importerEnv } = await import("../src/importer/env.ts");
	expect(importerEnv.JIRA_URL).toBeUndefined();
	expect(importerEnv.JIRA_PAT).toBeUndefined();
	expect(importerEnv.CONFLUENCE_URL).toBeUndefined();
	expect(importerEnv.CONFLUENCE_PAT).toBeUndefined();
	expect(importerEnv.ATTACHMENTS_DIR).toBe("./data/attachments");
	expect(importerEnv.AVATARS_DIR).toBe("./data/avatars");
});

test("importing the module does not validate the environment", async () => {
	vi.stubEnv("DATABASE_URL", "");
	await expect(import("../src/importer/env.ts")).resolves.toBeDefined();
});

test("a half-configured Jira pair fails when a value is read", async () => {
	vi.stubEnv("JIRA_URL", "https://jira.example.com");
	vi.stubEnv("JIRA_PAT", "");

	const { importerEnv } = await import("../src/importer/env.ts");
	expect(() => importerEnv.ATTACHMENTS_DIR).toThrow(
		"JIRA_URL and JIRA_PAT must be set together",
	);
});

test("a half-configured Confluence pair fails when a value is read", async () => {
	vi.stubEnv("CONFLUENCE_URL", "https://confluence.example.com");
	vi.stubEnv("CONFLUENCE_PAT", "");

	const { importerEnv } = await import("../src/importer/env.ts");
	expect(() => importerEnv.ATTACHMENTS_DIR).toThrow(
		"CONFLUENCE_URL and CONFLUENCE_PAT must be set together",
	);
});
