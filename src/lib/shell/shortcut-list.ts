/** The shortcuts the help dialog lists, in the order Jira lists them. */
export const ISSUE_SHORTCUTS = [
	{ keys: "e", label: "Edit issue" },
	{ keys: "a", label: "Assign issue" },
	{ keys: "i", label: "Assign to me" },
	{ keys: "m", label: "Comment on issue" },
	{ keys: "l", label: "Edit labels" },
	{ keys: ".", label: "Open the actions menu" },
	{ keys: "?", label: "Show this help" },
	{ keys: "j", label: "Next issue (detail view)" },
	{ keys: "k", label: "Previous issue (detail view)" },
	{ keys: "/", label: "Focus quick search" },
	{ keys: "c", label: "Create issue" },
	{ keys: "g d", label: "Go to the dashboard" },
	{ keys: "g i", label: "Go to the issue navigator" },
	{ keys: "g p", label: "Go to projects" },
	{ keys: "g b", label: "Go to boards" },
] as const;
