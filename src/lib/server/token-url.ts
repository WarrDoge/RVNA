function isLoopbackHost(hostname: string) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const match = hostname.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	return Boolean(match?.slice(1).every((part) => Number(part) <= 255));
}

/** A URL that may receive an access token: HTTPS, or HTTP to this machine, without a user name or password. */
export function isTokenSafeUrl(value: string) {
	try {
		const url = new URL(value);
		const secure =
			url.protocol === "https:" ||
			(url.protocol === "http:" && isLoopbackHost(url.hostname));
		return secure && url.username === "" && url.password === "";
	} catch {
		return false;
	}
}
