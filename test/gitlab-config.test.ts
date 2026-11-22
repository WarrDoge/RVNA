import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { pool, runMigrations } from "../src/lib/server/db.ts";

vi.mock("../src/lib/server/gitlab/crypto.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../src/lib/server/gitlab/crypto.ts")>();
	return {
		...actual,
		decryptSecret: () => {
			throw new Error("cannot decrypt");
		},
	};
});

const { gitlabSettings, saveBaseUrl } = await import(
	"../src/lib/server/gitlab/config.ts"
);

beforeAll(async () => {
	await runMigrations();
});

afterAll(async () => {
	await pool.query(
		"drop trigger if exists rvna_test_gitlab_config_skip on gitlab_config",
	);
	await pool.query("drop function if exists rvna_test_gitlab_config_skip()");
	await pool.query(
		"update gitlab_config set base_url = '', webhook_secret = null, access_token = null, last_delivery_at = null, last_delivery_status = null",
	);
	await pool.end();
});

test("a configuration row that cannot be created is reported", async () => {
	await pool.query("delete from gitlab_config");
	await pool.query(`
		create or replace function rvna_test_gitlab_config_skip()
		returns trigger language plpgsql as $$
		begin
			return null;
		end
		$$;
		create trigger rvna_test_gitlab_config_skip
		before insert on gitlab_config
		for each row execute function rvna_test_gitlab_config_skip();
	`);
	try {
		await expect(gitlabSettings()).rejects.toThrow(
			"GitLab configuration row is missing",
		);
	} finally {
		await pool.query(
			"drop trigger if exists rvna_test_gitlab_config_skip on gitlab_config",
		);
		await pool.query("drop function if exists rvna_test_gitlab_config_skip()");
	}
});

test("an undecryptable secret is logged without its value", async () => {
	await saveBaseUrl("https://gitlab.example.test");
	await pool.query(
		"update gitlab_config set webhook_secret = 'v1:not-a-real-secret' where id = 1",
	);
	const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		const settings = await gitlabSettings();
		expect(settings.webhookSecret).toBeNull();
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("webhook secret"),
			expect.any(Error),
		);
		expect(JSON.stringify(spy.mock.calls)).not.toContain(
			"v1:not-a-real-secret",
		);
	} finally {
		spy.mockRestore();
		await pool.query("update gitlab_config set webhook_secret = null");
	}
});

test("a save creates the missing configuration row", async () => {
	await pool.query("delete from gitlab_config");
	await saveBaseUrl("https://gitlab.example.test/");
	const { rows } = await pool.query(
		"select base_url from gitlab_config where id = 1",
	);
	expect(rows).toEqual([{ base_url: "https://gitlab.example.test" }]);
});
