import { expect, test } from "vitest";
import {
	mailEnabled,
	setMailTransport,
	startMail,
} from "../src/lib/server/mail.ts";

test("mail stays disabled when the queue cannot start", async () => {
	setMailTransport(null);
	const started = await startMail({ sendMail: async () => ({}) }, async () => {
		throw new Error("queue unavailable");
	});
	expect(started).toBe(false);
	expect(mailEnabled()).toBe(false);

	const startedOk = await startMail(
		{ sendMail: async () => ({}) },
		async () => undefined,
	);
	expect(startedOk).toBe(true);
	expect(mailEnabled()).toBe(true);
	setMailTransport(null);
});
