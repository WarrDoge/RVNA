import { expect, test } from "vitest";
import { createMessengerWorker } from "../src/lib/server/messenger/worker.ts";

test("a run started during stop is not cleared by the finished run", async () => {
	const runs: (() => void)[] = [];
	const runner = (signal: AbortSignal) =>
		new Promise<void>((resolve) => {
			runs.push(resolve);
			signal.addEventListener("abort", () => resolve(), { once: true });
		});
	const worker = createMessengerWorker(runner);

	worker.start();
	expect(runs).toHaveLength(1);
	const stopping = worker.stop();
	worker.start();
	expect(runs).toHaveLength(2);
	await stopping;
	worker.start();
	expect(runs).toHaveLength(2);
	await worker.stop();
});
