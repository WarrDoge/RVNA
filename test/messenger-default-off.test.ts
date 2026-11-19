import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { db, pool, runMigrations } from "../src/lib/server/db.ts";
import { messengerSettings } from "../src/lib/server/messenger/config.ts";
import { enqueueMessengerNotice } from "../src/lib/server/messenger/notices.ts";
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

test("a fresh install is off, has no address or token, and makes no network request", async () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	const settings = await messengerSettings();
	expect(settings).toMatchObject({
		homeserverUrl: "",
		accessToken: null,
		enabled: false,
		serviceDeskId: null,
		requestTypeId: null,
		sinceToken: null,
		botMatrixId: null,
	});

	const worker = createMessengerWorker();
	worker.start();
	await new Promise((resolve) => setTimeout(resolve, 1500));
	expect(worker.isRunning()).toBe(false);
	await worker.stop();

	await enqueueMessengerNotice({
		kind: "status",
		issueId: "00000000-0000-4000-8000-000000000001",
		status: "Done",
	});

	expect(fetchSpy).not.toHaveBeenCalled();
	fetchSpy.mockRestore();
});
