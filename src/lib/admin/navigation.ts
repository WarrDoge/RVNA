export const adminNavigation = [
	{
		heading: "Projects",
		items: [{ label: "Projects", href: "/secure/project/ViewProjects.jspa" }],
	},
	{
		heading: "Issues",
		items: [
			{ label: "Issue types", href: "/secure/admin/ViewIssueTypes.jspa" },
			{
				label: "Workflows",
				href: "/secure/admin/workflows/ListWorkflows.jspa",
				match: [
					"/secure/admin/workflows/ViewWorkflowSteps.jspa",
					"/plugins/servlet/project-config/",
				],
			},
			{ label: "Statuses", href: "/secure/admin/ViewStatuses.jspa" },
			{ label: "Resolutions", href: "/secure/admin/ViewResolutions.jspa" },
			{ label: "Priorities", href: "/secure/admin/ViewPriorities.jspa" },
			{
				label: "Issue linking",
				href: "/secure/admin/ViewLinkTypes!default.jspa",
			},
			{
				label: "Custom fields",
				href: "/secure/admin/ViewCustomFields.jspa",
				match: ["/secure/admin/ConfigureCustomField!default.jspa"],
			},
			{
				label: "Permission schemes",
				href: "/secure/admin/ViewPermissionSchemes.jspa",
			},
		],
	},
	{
		heading: "User management",
		items: [
			{
				label: "Users",
				href: "/secure/admin/user/UserBrowser.jspa",
				match: ["/secure/admin/user/ViewUser.jspa"],
			},
			{
				label: "Groups",
				href: "/secure/admin/user/GroupBrowser.jspa",
				match: ["/secure/admin/user/ViewGroup.jspa"],
			},
		],
	},
	{
		heading: "System",
		items: [
			{
				label: "General configuration",
				href: "/secure/admin/ViewApplicationProperties.jspa",
			},
			{
				label: "Global permissions",
				href: "/secure/admin/ViewGlobalPermissions.jspa",
			},
			{ label: "Audit log", href: "/secure/admin/ViewAuditLog.jspa" },
			{ label: "System info", href: "/secure/admin/ViewSystemInfo.jspa" },
		],
	},
] as const;

/** Targets of the Administration gear dropdown. */
export const adminMenu = [
	{ label: "Projects", href: "/secure/project/ViewProjects.jspa" },
	{ label: "Issues", href: "/secure/admin/ViewIssueTypes.jspa" },
	{ label: "User management", href: "/secure/admin/user/UserBrowser.jspa" },
	{ label: "GitLab", href: "/plugins/servlet/gitlab" },
	{ label: "Messenger", href: "/plugins/servlet/messenger" },
	{
		label: "System",
		href: "/secure/admin/ViewApplicationProperties.jspa",
	},
] as const;
