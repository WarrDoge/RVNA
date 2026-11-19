/**
 * The issue navigator's old Jira addresses. The address bar keeps the old
 * address; only the route that answers it changes. A plain `/browse/<KEY>`
 * without a query is the issue page and is left alone.
 */
export function reroute(url: URL): string | undefined {
	if (url.pathname === "/secure/IssueNavigator.jspa") return "/issues/";

	if (/^\/browse\/[^/]+$/.test(url.pathname)) {
		const jql = url.searchParams.get("jql");
		if (jql !== null && jql !== "") return "/issues/";
	}

	return undefined;
}
