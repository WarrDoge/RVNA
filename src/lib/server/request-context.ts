import { AsyncLocalStorage } from "node:async_hooks";
import type { DateContext } from "#lib/dates.ts";
import { env } from "./env.ts";

const storage = new AsyncLocalStorage<DateContext>();
const cacheStorage = new AsyncLocalStorage<Map<object, unknown>>();

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

/** A cache for the lifetime of one request, so one request loads shared data once. */
export function runWithRequestCache<T>(fn: () => T): T {
	return cacheStorage.run(new Map(), fn);
}

export function requestCache<T>(
	key: object,
	load: () => Promise<T>,
): Promise<T> {
	const cache = cacheStorage.getStore();
	if (!cache) return load();
	const existing = cache.get(key);
	if (existing) return existing as Promise<T>;
	const promise = load();
	cache.set(key, promise);
	return promise;
}
