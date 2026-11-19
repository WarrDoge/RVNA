import { AsyncLocalStorage } from "node:async_hooks";
import type { DateContext } from "#lib/dates.ts";
import { env } from "./env.ts";

const storage = new AsyncLocalStorage<DateContext>();

/** The date context of the request being served, if any. */
export function dateContext(): DateContext {
	return (
		storage.getStore() ?? {
			timeZone: env.APP_TIME_ZONE,
			locale: "en-GB",
			now: Date.now(),
		}
	);
}

export function runWithDateContext<T>(context: DateContext, fn: () => T): T {
	return storage.run(context, fn);
}
