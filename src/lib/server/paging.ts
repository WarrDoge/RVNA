import { error } from "@sveltejs/kit";
import { z } from "zod";

/** The largest page offset a list or search accepts. A larger one is a 400, not a database error. */
export const MAX_OFFSET = 1_000_000;

/** A page offset or `startAt` from a query string. */
export const offsetQuery = z.coerce
	.number()
	.int()
	.min(0)
	.max(MAX_OFFSET)
	.default(0);

/** The same offset from a page address: text that is no count is the first page. */
export function offsetParam(value: string | null) {
	const parsed = Number(value ?? "0");
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	if (parsed > MAX_OFFSET) error(400, `The offset is at most ${MAX_OFFSET}.`);
	return Math.floor(parsed);
}
