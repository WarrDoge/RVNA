import { expect, test, vi } from "vitest";

const { getBoss } = vi.hoisted(() => ({ getBoss: vi.fn() }));

vi.mock("../src/lib/server/boss.ts", () => ({
	getBoss,
	stopBoss: async () => undefined,
}));

const { startMessengerQueue } = await import(
	"../src/lib/server/messenger/notices.ts"
);

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
