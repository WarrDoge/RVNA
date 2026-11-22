import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
	getBoss: vi.fn(),
	selectRows: vi.fn(),
}));

vi.mock("../src/lib/server/boss.ts", () => ({
	getBoss: state.getBoss,
	stopBoss: async () => undefined,
}));

vi.mock("../src/lib/server/db.ts", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => state.selectRows(),
			}),
		}),
	},
}));

const { EMAIL_QUEUE, mailEnabled, startEmailQueue, startMail } = await import(
	"../src/lib/server/mail.ts"
);

const sender = { sendMail: async () => ({}) };

beforeEach(() => {
	state.getBoss.mockReset();
	state.selectRows.mockReset();
});

test("one batch that cannot be queued does not stop the rest of the replay", async () => {
	const queued: string[] = [];
	const instance = {
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
		offWork: vi.fn(async () => undefined),
		send: vi.fn(async (_queue: string, data: { batchId: string }) => {
			if (data.batchId === "bad") throw new Error("unreadable row");
			queued.push(data.batchId);
			return "job";
		}),
	};
	state.getBoss.mockResolvedValue(instance);
	state.selectRows.mockResolvedValue([
		{ id: "bad", sendAfter: new Date(Date.now() + 1_000) },
		{ id: "good", sendAfter: new Date(Date.now() + 1_000) },
	]);
	const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		await expect(startEmailQueue(sender)).resolves.toBeUndefined();
	} finally {
		errors.mockRestore();
	}
	expect(queued).toEqual(["good"]);
});

test("a failed start unregisters the worker it had already registered", async () => {
	const offWork = vi.fn(async () => undefined);
	const instance = {
		createQueue: vi.fn(async () => undefined),
		work: vi.fn(async () => undefined),
		offWork,
		send: vi.fn(async () => "job"),
	};
	state.getBoss.mockResolvedValue(instance);
	state.selectRows.mockRejectedValue(new Error("the database is unavailable"));
	const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
	try {
		await expect(startMail(sender)).resolves.toBe(false);
	} finally {
		errors.mockRestore();
	}
	expect(mailEnabled()).toBe(false);
	expect(offWork).toHaveBeenCalledWith(EMAIL_QUEUE);
});
