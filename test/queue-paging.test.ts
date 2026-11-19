import { expect, test } from "vitest";
import {
	clampStartAt,
	queuePageSize,
} from "../src/routes/projects/[key]/queues/queue.ts";

test("a start offset past the end of the queue becomes the offset of the last page", () => {
	expect(clampStartAt(0, 0)).toBe(0);
	expect(clampStartAt(0, 10)).toBe(0);
	expect(clampStartAt(5, 10)).toBe(5);
	expect(clampStartAt(500, 10)).toBe(0);
	expect(clampStartAt(500, queuePageSize)).toBe(0);
	expect(clampStartAt(500, queuePageSize + 1)).toBe(queuePageSize);
	expect(clampStartAt(900, 120)).toBe(100);
	expect(clampStartAt(queuePageSize, 120)).toBe(queuePageSize);
});
