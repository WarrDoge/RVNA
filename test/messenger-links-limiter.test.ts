import { expect, test, vi } from "vitest";

vi.mock("../src/lib/server/db.ts", () => ({
	db: {
		select: () => ({
			from: () => ({
				innerJoin: () => ({
					where: () => ({
						limit: async () => [],
					}),
				}),
			}),
		}),
	},
}));

vi.mock("../src/lib/server/messenger/config.ts", () => ({
	messengerSettings: async () => ({
		enabled: true,
		botMatrixId: "@bot:test",
	}),
}));

const { redeemMessengerLinkCode } = await import(
	"../src/lib/server/messenger/links.ts"
);

test("a large window of wrong codes is not rescanned on every failure", async () => {
	for (let number = 0; number < 1200; number += 1) {
		await redeemMessengerLinkCode(`@spray-${number}:test`, "WRONG");
	}
	const filter = vi.spyOn(Array.prototype, "filter");
	try {
		const result = await redeemMessengerLinkCode("@one-more:test", "WRONG");
		expect(result.ok).toBe(false);
		expect(filter.mock.calls.length).toBeLessThan(10);
	} finally {
		filter.mockRestore();
	}
});
