import { afterEach, expect, test, vi } from "vitest";

const { getBoss } = vi.hoisted(() => ({ getBoss: vi.fn() }));

vi.mock("../src/lib/server/boss.ts", () => ({
	getBoss,
	stopBoss: async () => undefined,
}));

vi.mock("../src/lib/server/db.ts", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => [{ id: "thread-1" }],
				}),
			}),
		}),
	},
}));

vi.mock("../src/lib/server/messenger/config.ts", () => ({
	messengerSettings: async () => ({
		enabled: true,
		accessToken: "test-token",
	}),
}));

const { enqueueMessengerNotice, startMessengerQueue, stopMessengerQueue } =
	await import("../src/lib/server/messenger/notices.ts");

afterEach(async () => {
	await stopMessengerQueue();
	vi.clearAllMocks();
});

test("a failed messenger queue start is retried on the next notice", async () => {
	const instance = {
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
	};
	getBoss
		.mockRejectedValueOnce(new Error("the database is unavailable"))
		.mockResolvedValueOnce(instance);

	await expect(startMessengerQueue()).rejects.toThrow(
		"the database is unavailable",
	);
	await expect(startMessengerQueue()).resolves.toBe(instance);
	expect(getBoss).toHaveBeenCalledTimes(2);
});

test("a notice the queue does not accept is an error, not a silent drop", async () => {
	const instance = {
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
		send: vi.fn(async () => null),
	};
	getBoss.mockResolvedValueOnce(instance);

	await expect(
		enqueueMessengerNotice({
			kind: "status",
			issueId: "00000000-0000-4000-8000-000000000001",
			status: "Done",
		}),
	).rejects.toThrow("not queued");
	expect(instance.send).toHaveBeenCalledTimes(1);
});
