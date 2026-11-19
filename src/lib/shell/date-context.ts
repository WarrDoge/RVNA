import { browserDateDefaults, setClientNow } from "#lib/dates.ts";
import { refreshAll } from "$app/navigation";

type ServerDateContext = {
	timeZone?: string;
	locale?: string;
	now?: number;
};

let requestedRefresh = false;

function readCookie(name: string) {
	const prefix = `${name}=`;
	for (const item of document.cookie.split(";")) {
		const value = item.trim();
		if (!value.startsWith(prefix)) continue;
		const raw = value.slice(prefix.length);
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	return null;
}

function writeCookie(name: string, value: string) {
	// biome-ignore lint/suspicious/noDocumentCookie: the server reads these cookies on the next request
	document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

/** Call before the shell renders so relative text hydrates with the server's `now`. */
export function useServerNow(now: number | undefined) {
	setClientNow(typeof now === "number" ? now : null);
}

/**
 * The browser is the authority on its own zone and language. Store them for
 * later requests, and refresh once when this response used something else.
 */
export function syncDateContext(server: ServerDateContext) {
	if (typeof document === "undefined") return;

	const { timeZone, locale } = browserDateDefaults();
	if (readCookie("tz") !== timeZone) writeCookie("tz", timeZone);
	if (readCookie("locale") !== locale) writeCookie("locale", locale);

	if (
		!requestedRefresh &&
		(server.timeZone !== timeZone || server.locale !== locale)
	) {
		requestedRefresh = true;
		void refreshAll();
	}

	// After hydration relative text uses the browser clock again.
	setClientNow(null);
}
