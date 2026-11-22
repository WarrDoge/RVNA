/**
 * Every Jira URL shape this app answers. `redirect` entries are handled by the
 * server and say where they go; `spa` entries render the single page app and
 * name the route that takes them; `rest` entries answer Jira-shaped JSON in
 * place, without a redirect.
 */
export const LEGACY_URLS: {
	pattern: string;
	example: string;
	target: string;
	kind: "redirect" | "spa" | "rest";
}[] = [
	{
		pattern: "/browse/<KEY>-<n>",
		example: "/browse/DEMO-1",
		target: "/browse/<KEY>-<n>",
		kind: "spa",
	},
	{
		pattern: "/browse/<KEY>",
		example: "/browse/DEMO",
		target: "/projects/<KEY>/summary",
		kind: "redirect",
	},
	{
		pattern: "/projects/<KEY>/issues/<KEY>-<n>",
		example: "/projects/DEMO/issues/DEMO-1",
		target: "/browse/<KEY>-<n>",
		kind: "redirect",
	},
	{
		pattern: "/projects/<KEY>/summary",
		example: "/projects/DEMO/summary",
		target: "/projects/<KEY>/summary",
		kind: "spa",
	},
	{
		pattern: "/issues/?jql=",
		example: "/issues/?jql=project%20%3D%20TER",
		target: "/issues/?jql=",
		kind: "spa",
	},
	{
		pattern: "/issues/?filter=<source id>",
		example: "/issues/?filter=10200",
		target: "/issues/?filter=<uuid>",
		kind: "redirect",
	},
	{
		pattern: "/secure/IssueNavigator.jspa?jqlQuery=",
		example:
			"/secure/IssueNavigator.jspa?mode=hide&jqlQuery=project%20%3D%20TER",
		target: "/issues/?jql=",
		kind: "spa",
	},
	{
		pattern: "/secure/IssueNavigator.jspa",
		example: "/secure/IssueNavigator.jspa?mode=hide",
		target: "/secure/IssueNavigator.jspa",
		kind: "spa",
	},
	{
		pattern: "/secure/QuickSearch.jspa?searchString=",
		example: "/secure/QuickSearch.jspa?searchString=DEMO-1",
		target: "/browse/<KEY>-<n> or /issues/?jql=text ~ ...",
		kind: "redirect",
	},
	{
		pattern: "/secure/ViewProfile.jspa?name=",
		example: "/secure/ViewProfile.jspa?name=dev",
		target: "/secure/ViewProfile.jspa?name=dev",
		kind: "spa",
	},
	{
		pattern: "/secure/attachment/<source id>/<filename>",
		example: "/secure/attachment/10001/report.pdf",
		target: "/api/attachments/<source id>",
		kind: "redirect",
	},
	{
		pattern: "/secure/attachmentzip/<issue id>.zip",
		example: "/secure/attachmentzip/10001.zip",
		target: "501 Not Implemented",
		kind: "redirect",
	},
	{
		pattern: "/secure/CreateIssue!default.jspa",
		example: "/secure/CreateIssue!default.jspa",
		target: "/issues/?create=1",
		kind: "redirect",
	},
	{
		pattern: "/secure/ManageFilters.jspa",
		example: "/secure/ManageFilters.jspa",
		target: "/secure/ManageFilters.jspa",
		kind: "spa",
	},
	{
		pattern: "/secure/BrowseProjects.jspa",
		example: "/secure/BrowseProjects.jspa",
		target: "/secure/BrowseProjects.jspa",
		kind: "spa",
	},
	{
		pattern: "/plugins/servlet/project-config/<KEY>/summary",
		example: "/plugins/servlet/project-config/DEMO/summary",
		target: "/plugins/servlet/project-config/<KEY>/summary",
		kind: "spa",
	},
	{
		pattern: "/secure/Logout!default.jspa",
		example: "/secure/Logout!default.jspa",
		target: "/login.jsp",
		kind: "redirect",
	},
	{
		pattern: "/secure/Dashboard.jspa?selectPageId=<source id>",
		example: "/secure/Dashboard.jspa?selectPageId=10000",
		target: "/secure/Dashboard.jspa?selectPageId=<uuid>",
		kind: "redirect",
	},
	{
		pattern: "/secure/Dashboard.jspa",
		example: "/secure/Dashboard.jspa",
		target: "/secure/Dashboard.jspa",
		kind: "spa",
	},
	{
		pattern: "/secure/ConfigurePortalPages!default.jspa",
		example: "/secure/ConfigurePortalPages!default.jspa",
		target: "/secure/ConfigurePortalPages!default.jspa",
		kind: "spa",
	},
	{
		pattern: "/rest/api/2/issue/<KEY>",
		example: "/rest/api/2/issue/DEMO-1",
		target: "Jira issue JSON",
		kind: "rest",
	},
	{
		pattern: "/rest/api/2/search?jql=",
		example: "/rest/api/2/search?jql=project=DEMO",
		target: "Jira search JSON",
		kind: "rest",
	},
];
