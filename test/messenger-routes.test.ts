import { expect, test, vi } from "vitest";
import type { CurrentUser } from "../src/lib/server/auth.ts";
import { HttpError } from "../src/lib/server/http.ts";

const state = vi.hoisted(() => ({
	whoami: async (): Promise<{ user_id: string }> => ({
		user_id: "@bot:matrix.example.com",
	}),
	saveIdentity: async (_identity: {
		userId: string;
		serverName: string;
	}): Promise<void> => undefined,
}));

vi.mock("../src/lib/server/messenger/client.ts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../src/lib/server/messenger/client.ts")
		>();
	return { ...actual, matrixWhoami: () => state.whoami() };
});

vi.mock("../src/lib/server/messenger/config.ts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../src/lib/server/messenger/config.ts")
		>();
	return {
		...actual,
		messengerSettings: async () => ({
			homeserverUrl: "https://matrix.example.com",
			accessToken: "test-token",
			serviceDeskId: null,
			requestTypeId: null,
			enabled: true,
			sinceToken: null,
			botMatrixId: "@bot:matrix.example.com",
			serverName: "matrix.example.com",
			lastSyncAt: null,
			lastError: null,
		}),
		saveMessengerIdentity: (identity: { userId: string; serverName: string }) =>
			state.saveIdentity(identity),
	};
});

const { MatrixClientError } = await import(
	"../src/lib/server/messenger/client.ts"
);
const { testMessengerConnection } = await import(
	"../src/lib/server/messenger/routes.ts"
);

const actor = {
	id: "00000000-0000-4000-8000-000000000001",
	displayName: "Admin",
	isAdmin: true,
} as CurrentUser;

test("a rejected bot token is a bad request, not a homeserver failure", async () => {
	state.whoami = async () => {
		throw new MatrixClientError(401, "Invalid access token passed.");
	};
	const error = await testMessengerConnection(actor).catch((cause) => cause);
	expect(error).toBeInstanceOf(HttpError);
	expect((error as HttpError).status).toBe(400);
	expect((error as HttpError).message).toBe("Invalid access token passed.");
});

test("a failure to save the identity is not reported as a homeserver failure", async () => {
	state.whoami = async () => ({ user_id: "@bot:matrix.example.com" });
	state.saveIdentity = async () => {
		throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
	};
	const error = await testMessengerConnection(actor).catch((cause) => cause);
	expect(error).not.toBeInstanceOf(HttpError);
	expect((error as Error).message).toContain("ECONNREFUSED");
});

test("an unexpected homeserver failure keeps its details out of the response", async () => {
	state.whoami = async () => {
		throw new Error("socket hang up");
	};
	state.saveIdentity = async () => undefined;
	const error = await testMessengerConnection(actor).catch((cause) => cause);
	expect(error).toBeInstanceOf(HttpError);
	expect((error as HttpError).status).toBe(502);
	expect((error as HttpError).message).toBe("The homeserver is unreachable");
});
