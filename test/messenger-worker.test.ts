import { Client } from "pg";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { createMessengerWorker } from "../src/lib/server/messenger/worker.ts";
import { messengerConfig } from "../src/lib/server/schema.ts";

beforeAll(async () => {
	await runMigrations();
	await db.delete(messengerConfig);
});

afterAll(async () => {
	await db.delete(messengerConfig);
	await pool.end();
});

test("the lock connection listens for errors", async () => {
	const onSpy = vi.spyOn(Client.prototype, "on");
	const worker = createMessengerWorker();
	try {
		worker.start();
		const deadline = Date.now() + 5_000;
		while (
			Date.now() < deadline &&
			!onSpy.mock.calls.some((call) => call[0] === "error")
		) {
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		expect(onSpy.mock.calls.some((call) => call[0] === "error")).toBe(true);
	} finally {
		await worker.stop();
		onSpy.mockRestore();
	}
});
