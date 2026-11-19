const RECENT_SPACES_KEY = "rvna.wiki.recentSpaces";

const wikiPrefixes = [
	"/wiki",
	"/dashboard.action",
	"/spacedirectory/",
	"/display/",
	"/spaces/",
	"/pages/",
	"/label/",
	"/dosearchsite.action",
];

export function isWikiPath(pathname: string) {
	return wikiPrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(prefix),
	);
}

type WikiContext = { spaceKey: string | null; pageId: string | null };
let currentContext: WikiContext = { spaceKey: null, pageId: null };

/** Called by the space and page screens so Create and Share know the context. */
export function setWikiContext(context: WikiContext) {
	currentContext = context;
}

function contextFromPath(pathname: string, search: string): WikiContext {
	const match = pathname.match(/^\/(?:display|spaces)\/([^/]+)/);
	const spaceKey = match ? decodeURIComponent(match[1] ?? "") : null;
	const pageId = new URLSearchParams(search).get("pageId");
	return { spaceKey, pageId };
}

/** The editor route the Create button opens on wiki pages. */
export function wikiCreateTarget(
	pathname = window.location.pathname,
	search = window.location.search,
) {
	if (!isWikiPath(pathname)) return null;
	const context = {
		...contextFromPath(pathname, search),
		...currentContext,
	};
	return context.spaceKey
		? `/pages/createpage.action?spaceKey=${encodeURIComponent(context.spaceKey)}`
		: "/pages/createpage.action";
}

export function recentSpaces(): string[] {
	try {
		const raw = window.localStorage.getItem(RECENT_SPACES_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.filter((value): value is string => typeof value === "string")
			: [];
	} catch {
		return [];
	}
}

export function rememberSpace(key: string) {
	const next = [key, ...recentSpaces().filter((value) => value !== key)].slice(
		0,
		6,
	);
	window.localStorage.setItem(RECENT_SPACES_KEY, JSON.stringify(next));
}
