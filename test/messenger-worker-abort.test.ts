import { expect, test, vi } from "vitest";

const deferred = vi.hoisted(() => {
	let started!: () => void;
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	let release!: () => void;
	const errorPromise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { started, startedPromise, release, errorPromise };
});

vi.mock("pg", () => ({
	Client: class {
		on() {}
		async connect() {}
		async query() {
			return { rows: [{ locked: true }] };
		}
		async end() {}
	},
	default: { Pool: class {} },
}));

vi.mock("../src/lib/server/messenger/client.ts", () => ({
	MatrixClientError: class extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
	matrixSync: async () => {
		throw new Error("sync failed");
	},
	matrixJoin: async () => ({}),
	matrixMessages: async () => ({ chunk: [] }),
	matrixSendText: async () => ({}),
	matrixWhoami: async () => ({ user_id: "@bot:test" }),
}));

vi.mock("../src/lib/server/messenger/config.ts", () => ({
	messengerSettings: async () => ({
		homeserverUrl: "http://127.0.0.1:1",
		accessToken: "test-token",
		serviceDeskId: null,
		requestTypeId: null,
		enabled: true,
		sinceToken: null,
		botMatrixId: "@bot:test",
		serverName: "test",
		lastSyncAt: null,
		lastError: null,
	}),
	matrixServerName: () => "test",
	recordMessengerError: () => {
		deferred.started();
		return deferred.errorPromise;
	},
	recordMessengerSync: async () => undefined,
	saveMessengerIdentity: async () => undefined,
	saveMessengerSinceToken: async () => undefined,
}));

const { createMessengerWorker } = await import(
	"../src/lib/server/messenger/worker.ts"
);

test("stopping during an error record does not wait for the backoff", async () => {
	const worker = createMessengerWorker();
	worker.start();
	await deferred.startedPromise;

	const stopping = worker.stop();
	await new Promise((resolve) => setTimeout(resolve, 20));
	deferred.release();

	const startedAt = Date.now();
	await stopping;
	expect(Date.now() - startedAt).toBeLessThan(1000);
});
