import { beforeEach, expect, test, vi } from "vitest";

type StartControl = {
	resolve: () => void;
	reject: (error: Error) => void;
};

type FakeBoss = {
	start: () => Promise<unknown>;
	stop: ReturnType<typeof vi.fn>;
};

const fake = vi.hoisted(() => ({
	instances: [] as FakeBoss[],
	starts: [] as StartControl[],
}));

vi.mock("pg-boss", () => {
	class PgBoss {
		stop = vi.fn(async () => undefined);

		constructor() {
			fake.instances.push(this as unknown as FakeBoss);
		}

		on() {}

		start() {
			return new Promise((resolve, reject) => {
				fake.starts.push({ resolve: () => resolve(this), reject });
			});
		}
	}
	return { PgBoss };
});

beforeEach(() => {
	vi.resetModules();
	fake.instances.length = 0;
	fake.starts.length = 0;
});

async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}

test("concurrent callers share one instance", async () => {
	const { getBoss } = await import("../src/lib/server/boss.ts");

	const first = getBoss();
	const second = getBoss();
	await flush();
	expect(fake.instances).toHaveLength(1);

	fake.starts[0].resolve();
	expect(await first).toBe(await second);
});

test("a start that throws closes the instance it opened", async () => {
	const { getBoss } = await import("../src/lib/server/boss.ts");

	const pending = getBoss();
	await flush();
	const instance = fake.instances[0];
	fake.starts[0].reject(new Error("start failed"));

	await expect(pending).rejects.toThrow("start failed");
	expect(instance.stop).toHaveBeenCalledWith({ close: true });
});

test("a start that failed is not reused", async () => {
	const { getBoss } = await import("../src/lib/server/boss.ts");

	const first = getBoss();
	await flush();
	fake.starts[0].reject(new Error("start failed"));
	await expect(first).rejects.toThrow("start failed");

	const second = getBoss();
	await flush();
	expect(fake.instances).toHaveLength(2);
	fake.starts[1].resolve();
	expect(await second).toBe(fake.instances[1]);
});

test("a stop in flight keeps another instance from starting", async () => {
	const { getBoss, stopBoss } = await import("../src/lib/server/boss.ts");

	const first = getBoss();
	await flush();
	expect(fake.instances).toHaveLength(1);

	const stopping = stopBoss();
	await flush();
	const afterStop = getBoss();
	await flush();
	expect(fake.instances).toHaveLength(1);

	fake.starts[0].resolve();
	expect(await first).toBe(fake.instances[0]);
	await stopping;
	expect(fake.instances[0].stop).toHaveBeenCalledTimes(1);

	await flush();
	expect(fake.instances).toHaveLength(2);
	fake.starts[1].resolve();
	expect(await afterStop).toBe(fake.instances[1]);
});

test("stopping waits for the instance that was still starting", async () => {
	const { getBoss, stopBoss } = await import("../src/lib/server/boss.ts");

	const first = getBoss();
	await flush();
	const stopping = stopBoss();
	await flush();

	fake.starts[0].resolve();
	expect(await first).toBe(fake.instances[0]);
	await stopping;
	expect(fake.instances[0].stop).toHaveBeenCalledTimes(1);

	const next = getBoss();
	await flush();
	expect(fake.instances).toHaveLength(2);
	fake.starts[1].resolve();
	expect(await next).toBe(fake.instances[1]);
});
