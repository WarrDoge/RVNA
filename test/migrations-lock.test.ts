import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { pool, runMigrations } from "../src/importer/db.ts";

vi.mock("drizzle-orm/node-postgres/migrator", () => ({ migrate: vi.fn() }));

const migrateMock = vi.mocked(migrate);

interface FakeClient {
	query: (text: string) => Promise<unknown>;
	release: (destroy?: boolean) => void;
}

function fakeClient(options: {
	unlockFails: boolean;
	releases: (boolean | undefined)[];
}): FakeClient {
	return {
		async query(text: string) {
			if (text.includes("pg_advisory_unlock") && options.unlockFails) {
				throw new Error("unlock failed");
			}
			return { rows: [] };
		},
		release(destroy?: boolean) {
			options.releases.push(destroy);
		},
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

afterAll(async () => {
	await pool.end();
});

test("destroys the client when the advisory lock cannot be released", async () => {
	migrateMock.mockResolvedValue(undefined);
	const releases: (boolean | undefined)[] = [];
	vi.spyOn(pool, "connect").mockResolvedValue(
		fakeClient({ unlockFails: true, releases }) as never,
	);

	await expect(runMigrations()).rejects.toThrow("unlock failed");
	expect(releases).toEqual([true]);
});

test("keeps the migration error and destroys the locked client", async () => {
	migrateMock.mockRejectedValue(new Error("migration failed"));
	const releases: (boolean | undefined)[] = [];
	vi.spyOn(pool, "connect").mockResolvedValue(
		fakeClient({ unlockFails: true, releases }) as never,
	);

	await expect(runMigrations()).rejects.toThrow("migration failed");
	expect(releases).toEqual([true]);
});

test("destroys the client when the migration fails even if the unlock succeeds", async () => {
	migrateMock.mockRejectedValue(new Error("migration failed"));
	const releases: (boolean | undefined)[] = [];
	vi.spyOn(pool, "connect").mockResolvedValue(
		fakeClient({ unlockFails: false, releases }) as never,
	);

	await expect(runMigrations()).rejects.toThrow("migration failed");
	expect(releases).toEqual([true]);
});

test("returns an unlocked client to the pool", async () => {
	migrateMock.mockResolvedValue(undefined);
	const releases: (boolean | undefined)[] = [];
	vi.spyOn(pool, "connect").mockResolvedValue(
		fakeClient({ unlockFails: false, releases }) as never,
	);

	await runMigrations();
	expect(releases).toEqual([undefined]);
});
