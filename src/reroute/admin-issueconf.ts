const aliases: Record<string, string> = {
	"/secure/admin/ViewIssueTypes!default.jspa":
		"/secure/admin/ViewIssueTypes.jspa",
	"/secure/admin/ViewStatuses!default.jspa": "/secure/admin/ViewStatuses.jspa",
	"/secure/admin/ViewResolutions!default.jspa":
		"/secure/admin/ViewResolutions.jspa",
	"/secure/admin/ViewPriorities!default.jspa":
		"/secure/admin/ViewPriorities.jspa",
	"/secure/admin/ViewLinkTypes.jspa":
		"/secure/admin/ViewLinkTypes!default.jspa",
};

export function reroute(url: URL): string | undefined {
	return aliases[url.pathname];
}
