const spaceOverview = /^\/spaces\/([^/]+)\/overview\/?$/;

export function reroute(url: URL): string | undefined {
	if (url.pathname === "/dashboard.action") return "/wiki";
	const overview = url.pathname.match(spaceOverview);
	if (overview) return `/display/${overview[1]}`;
	return undefined;
}
