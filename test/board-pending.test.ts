import { afterEach, expect, test, vi } from "vitest";
import {
	trackBoardMove,
	waitForBoardMoves,
} from "../src/lib/server/agile/pending.ts";

afterEach(() => {
	vi.useRealTimers();
});

test("a board read waits at most five seconds for a hung move", async () => {
	vi.useFakeTimers();
	const hung = new Promise<void>(() => {});
	trackBoardMove(91, hung);
	let done = false;
	const waiting = waitForBoardMoves(91).then(() => {
		done = true;
	});
	await vi.advanceTimersByTimeAsync(4_999);
	expect(done).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	await waiting;
	expect(done).toBe(true);
});

test("a settled move is removed and does not make the next read wait", async () => {
	const settled = Promise.resolve("moved");
	await trackBoardMove(92, settled);
	await waitForBoardMoves(92);
});

test("a rejected move is removed and does not make the next read wait", async () => {
	const rejected = Promise.reject(new Error("move failed"));
	await trackBoardMove(93, rejected).catch(() => {});
	await waitForBoardMoves(93);
});
