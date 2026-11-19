const LABELS: Record<string, string> = {
	BROWSE_PROJECTS: "Browse projects",
	CREATE_ISSUES: "Create issues",
	EDIT_ISSUES: "Edit issues",
	MODIFY_REPORTER: "Modify reporter",
	DELETE_ISSUES: "Delete issues",
	ASSIGN_ISSUES: "Assign issues",
	ASSIGNABLE_USER: "Assignable user",
	RESOLVE_ISSUES: "Resolve issues",
	CLOSE_ISSUES: "Close issues",
	TRANSITION_ISSUES: "Transition issues",
	SCHEDULE_ISSUES: "Schedule issues",
	MOVE_ISSUES: "Move issues",
	LINK_ISSUES: "Link issues",
	ADD_COMMENTS: "Add comments",
	EDIT_ALL_COMMENTS: "Edit all comments",
	EDIT_OWN_COMMENTS: "Edit own comments",
	DELETE_ALL_COMMENTS: "Delete all comments",
	DELETE_OWN_COMMENTS: "Delete own comments",
	CREATE_ATTACHMENTS: "Create attachments",
	DELETE_ALL_ATTACHMENTS: "Delete all attachments",
	DELETE_OWN_ATTACHMENTS: "Delete own attachments",
	WORK_ON_ISSUES: "Work on issues",
	WORKLOG_EDIT_ALL: "Edit all worklogs",
	WORKLOG_EDIT_OWN: "Edit own worklogs",
	WORKLOG_DELETE_ALL: "Delete all worklogs",
	WORKLOG_DELETE_OWN: "Delete own worklogs",
	MANAGE_WATCHERS: "Manage watchers",
	VIEW_VOTERS_AND_WATCHERS: "View voters and watchers",
	ADMINISTER_PROJECTS: "Administer projects",
	MANAGE_SPRINTS_PERMISSION: "Manage sprints",
	EDIT_SPRINT_NAME_AND_GOAL_PERMISSION: "Edit sprint name and goal",
	START_STOP_SPRINTS_PERMISSION: "Start and stop sprints",
	SERVICEDESK_AGENT: "Service desk agent",
};

/** Jira's permission name from its key, for screens that only have the key. */
export function permissionLabel(key: string) {
	const known = LABELS[key];
	if (known) return known;
	return key
		.toLowerCase()
		.split("_")
		.filter(Boolean)
		.map((word) => word[0]?.toUpperCase() + word.slice(1))
		.join(" ");
}
