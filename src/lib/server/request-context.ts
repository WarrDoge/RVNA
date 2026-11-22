import { AsyncLocalStorage } from "node:async_hooks";
import type { DateContext } from "#lib/dates.ts";
import { env } from "./env.ts";

const storage = new AsyncLocalStorage<DateContext>();
const cacheStorage = new AsyncLocalStorage<Map<object, unknown>>();

export const FALLBACK_TIME_ZONE = "UTC";
export const FALLBACK_LOCALE = "en-GB";

/** The canonical IANA name, or null when the value is not a time zone. */
export function canonicalTimeZone(value: string | null | undefined) {
	if (!value) return null;
	try {
		return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
			.timeZone;
	} catch {
		return null;
	}
}

let fallbackZone: { raw: string; zone: string } | undefined;

function configuredTimeZone() {
	const raw = env.APP_TIME_ZONE;
	if (fallbackZone?.raw !== raw) {
		fallbackZone = {
			raw,
			zone: canonicalTimeZone(raw) ?? FALLBACK_TIME_ZONE,
		};
	}
	return fallbackZone.zone;
}

/** The date context of the request being served, if any. */
export function dateContext(): DateContext {
	return (
		storage.getStore() ?? {
			timeZone: configuredTimeZone(),
			locale: FALLBACK_LOCALE,
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
