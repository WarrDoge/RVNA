import { expect, test, vi } from "vitest";

const { getBoss } = vi.hoisted(() => ({ getBoss: vi.fn() }));

vi.mock("../src/lib/server/boss.ts", () => ({
	getBoss,
	stopBoss: async () => undefined,
}));

const { startGitlabQueue } = await import("../src/lib/server/gitlab/queue.ts");

test("a failed queue start is retried on the next webhook", async () => {
	const instance = {
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
	};
	getBoss
		.mockRejectedValueOnce(new Error("the database is unavailable"))
		.mockResolvedValueOnce(instance);

	await expect(startGitlabQueue()).rejects.toThrow(
		"the database is unavailable",
	);
	await expect(startGitlabQueue()).resolves.toBe(instance);
	expect(getBoss).toHaveBeenCalledTimes(2);
});
