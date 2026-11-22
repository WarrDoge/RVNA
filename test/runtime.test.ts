import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
	calls: [] as string[],
	migrateError: null as Error | null,
	stopGitlabError: null as Error | null,
	mailStartFails: false,
}));

vi.mock("../src/lib/server/bootstrap.ts", () => ({
	bootstrapAdmin: async () => {
		state.calls.push("bootstrap");
	},
}));

vi.mock("../src/lib/server/db.ts", () => ({
	runMigrations: async () => {
		state.calls.push("migrate");
		if (state.migrateError) throw state.migrateError;
	},
	pool: {
		end: async () => {
			state.calls.push("pool.end");
		},
	},
}));

vi.mock("../src/lib/server/gitlab/queue.ts", () => ({
	startGitlabQueue: async () => {
		state.calls.push("gitlab.start");
	},
	stopGitlabQueue: async () => {
		state.calls.push("gitlab.stop");
		if (state.stopGitlabError) throw state.stopGitlabError;
	},
}));

vi.mock("../src/lib/server/mail.ts", () => ({
	createSmtpTransport: () => ({
		close: () => state.calls.push("mail.transport.close"),
	}),
	startMail: async () => {
		state.calls.push("mail.start");
		return !state.mailStartFails;
	},
	stopEmailQueue: async () => {
		state.calls.push("mail.queue.stop");
	},
	stopMail: async () => {
		state.calls.push("mail.transport.close");
	},
}));

vi.mock("../src/lib/server/messenger/notices.ts", () => ({
	startMessengerQueue: async () => {
		state.calls.push("messenger.start");
	},
	stopMessengerQueue: async () => {
		state.calls.push("messenger.stop");
	},
}));

vi.mock("../src/lib/server/messenger/worker.ts", () => ({
	startMessengerWorker: () => {
		state.calls.push("worker.start");
	},
	stopMessengerWorker: async () => {
		state.calls.push("worker.stop");
	},
}));

beforeEach(() => {
	state.calls.length = 0;
	state.migrateError = null;
	state.stopGitlabError = null;
	state.mailStartFails = false;
});

test("a failed start releases what it had already opened", async () => {
	const { start } = await import("../src/lib/server/runtime.ts");
	const failure = new Error("migration failed");
	state.migrateError = failure;

	await expect(start()).rejects.toBe(failure);
	expect(state.calls).toEqual(
		expect.arrayContaining([
			"migrate",
			"worker.stop",
			"messenger.stop",
			"gitlab.stop",
			"mail.queue.stop",
			"mail.transport.close",
			"pool.end",
		]),
	);
});

test("a failed mail queue start closes the SMTP transport", async () => {
	const { start } = await import("../src/lib/server/runtime.ts");
	state.mailStartFails = true;

	await start();

	expect(state.calls).toContain("mail.start");
	expect(state.calls).toContain("mail.transport.close");
});

test("one failing shutdown step does not skip the rest", async () => {
	const { start, stop } = await import("../src/lib/server/runtime.ts");
	await start();
	state.calls.length = 0;
	state.stopGitlabError = new Error("gitlab stop failed");

	await expect(stop()).resolves.toBeUndefined();
	expect(state.calls).toEqual([
		"worker.stop",
		"messenger.stop",
		"gitlab.stop",
		"mail.queue.stop",
		"mail.transport.close",
		"pool.end",
	]);
});
