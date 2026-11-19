import { afterEach, expect, test, vi } from "vitest";
import { ApiError, api } from "../src/lib/api.ts";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: string) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(body, { status })),
	);
}

test("an API error carries the status, the message and the parsed JSON body", async () => {
	answer(
		400,
		JSON.stringify({
			error: "The draft cannot be published yet",
			problems: [{ code: "removed_status_in_use", statusId: "s1" }],
		}),
	);
	const failure = (await api("/x", { method: "POST" }).catch(
		(cause) => cause,
	)) as ApiError;
	expect(failure).toBeInstanceOf(ApiError);
	expect(failure.status).toBe(400);
	expect(failure.message).toBe("The draft cannot be published yet");
	expect(failure.body).toEqual({
		error: "The draft cannot be published yet",
		problems: [{ code: "removed_status_in_use", statusId: "s1" }],
	});
});

test("an API error from a response that is not JSON has a null body", async () => {
	answer(502, "<html>bad gateway</html>");
	const failure = (await api("/x").catch((cause) => cause)) as ApiError;
	expect(failure).toBeInstanceOf(ApiError);
	expect(failure.status).toBe(502);
	expect(failure.body).toBeNull();
});

test("a validation error shows the detail in message, not the generic error", async () => {
	answer(
		400,
		JSON.stringify({
			statusCode: 400,
			code: "FST_ERR_VALIDATION",
			error: "Bad Request",
			message: "body/summary is required",
		}),
	);
	const failure = (await api("/x", { method: "POST" }).catch(
		(cause) => cause,
	)) as ApiError;
	expect(failure.status).toBe(400);
	expect(failure.message).toBe("body/summary is required");
	expect((failure.body as { error: string }).error).toBe("Bad Request");
});
