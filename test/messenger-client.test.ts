import { expect, test, vi } from "vitest";
import {
	MatrixClientError,
	matrixWhoami,
} from "../src/lib/server/messenger/client.ts";

test("an empty Matrix response is an error, not a null result", async () => {
	vi.stubGlobal("fetch", async () => new Response(null, { status: 204 }));
	try {
		await expect(
			matrixWhoami({
				homeserverUrl: "https://matrix.example.test",
				accessToken: "token",
			}),
		).rejects.toBeInstanceOf(MatrixClientError);
	} finally {
		vi.unstubAllGlobals();
	}
});

test("a non-JSON Matrix response is an error, not a null result", async () => {
	vi.stubGlobal(
		"fetch",
		async () =>
			new Response("<html>proxy error</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
	);
	try {
		await expect(
			matrixWhoami({
				homeserverUrl: "https://matrix.example.test",
				accessToken: "token",
			}),
		).rejects.toBeInstanceOf(MatrixClientError);
	} finally {
		vi.unstubAllGlobals();
	}
});
