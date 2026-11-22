import type { PgBoss } from "pg-boss";
import { expect, test, vi } from "vitest";

const { getBoss, stopBoss } = vi.hoisted(() => ({
	getBoss: vi.fn(),
	stopBoss: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/server/boss.ts", () => ({ getBoss, stopBoss }));

const { startGitlabQueue, stopGitlabQueue } = await import(
	"../src/lib/server/gitlab/queue.ts"
);

function instance(name: string) {
	return {
		name,
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
	} as unknown as PgBoss;
}

test("stopping during a pending start does not keep the stopped queue", async () => {
	let resolveStart!: (value: PgBoss) => void;
	const pending = new Promise<PgBoss>((resolve) => {
		resolveStart = resolve;
	});
	const first = instance("first");
	const second = instance("second");
	getBoss.mockReturnValueOnce(pending).mockResolvedValueOnce(second);

	const starting = startGitlabQueue();
	const stopping = stopGitlabQueue();
	resolveStart(first);
	await expect(starting).resolves.toBe(first);
	await stopping;

	await expect(startGitlabQueue()).resolves.toBe(second);
	expect(getBoss).toHaveBeenCalledTimes(2);
	expect(stopBoss).toHaveBeenCalledTimes(1);
});
