import { expect, test } from "vitest";
import { dateContext } from "../src/lib/server/request-context.ts";

test("an invalid configured time zone falls back to a usable zone", () => {
	const previous = process.env.APP_TIME_ZONE;
	process.env.APP_TIME_ZONE = "Not/AZone";
	try {
		const context = dateContext();
		expect(context.timeZone).toBe("UTC");
		expect(context.locale).toBe("en-GB");
		expect(() =>
			new Intl.DateTimeFormat(context.locale, {
				timeZone: context.timeZone,
			}).format(new Date()),
		).not.toThrow();
	} finally {
		if (previous === undefined) delete process.env.APP_TIME_ZONE;
		else process.env.APP_TIME_ZONE = previous;
	}
});
