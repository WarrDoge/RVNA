import type { QueryResultRow } from "pg";
import pg from "pg";

const { Pool } = pg;

export type Screen = {
	/** Stable, filesystem-safe identifier used by `--only` and the report. */
	id: string;
	/** Product area, only for grouping in the report. */
	area: "core" | "wiki" | "admin" | "servicedesk";
	/** Legacy product address, relative to the app origin. */
	path: string;
};

export type ResolvedAddresses = {
	database: string;
	screens: Screen[];
	/** Values that are useful to explain a row without storing any product text. */
	context: {
		project: string;
		issue: string;
		epic: string;
		subtask: string;
		board: number;
		kanbanBoard: number;
		wikiSpace: string;
		wikiPage: string;
		wikiChildPage: string;
		wikiAttachmentPage: string;
		deskProject: string;
		ordinaryUser: string;
		profileUser: string;
	};
};

type Row = QueryResultRow & Record<string, unknown>;

function databaseUrl() {
	return (
		process.env.QA_DATABASE_URL ??
		process.env.DATABASE_URL ??
		"postgres://rvna:rvna@127.0.0.1:55440/rvna_qa_new"
	);
}

function databaseName(connectionString: string) {
	try {
		const url = new URL(connectionString);
		return url.pathname.replace(/^\//, "");
	} catch {
		return "(unknown)";
	}
}

async function one<T extends Row>(
	pool: pg.Pool,
	sql: string,
	values?: unknown[],
) {
	const result = await pool.query<T>(sql, values);
	const row = result.rows[0];
	if (!row) throw new Error(`address query returned no row: ${sql}`);
	return row;
}

async function many<T extends Row>(
	pool: pg.Pool,
	sql: string,
	values?: unknown[],
) {
	const result = await pool.query<T>(sql, values);
	return result.rows;
}

function query(path: string, values: Record<string, string | number>) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		params.set(key, String(value));
	}
	const search = params.toString();
	return search ? `${path}?${search}` : path;
}

function segment(value: string | number) {
	return encodeURIComponent(String(value));
}

export async function resolveAddresses(): Promise<ResolvedAddresses> {
	const connectionString = databaseUrl();
	const pool = new Pool({ connectionString });
	try {
		const project = await one<{ key: string }>(
			pool,
			`select p.key
			 from projects p
			 left join issues i on i.project_id = p.id
			 group by p.id, p.key
			 order by count(i.id) desc, p.key
			 limit 1`,
		);
		const projectKey = project.key;

		const version = await one<{ id: string; project_key: string }>(
			pool,
			`select v.id, p.key as project_key
			 from versions v
			 join projects p on p.id = v.project_id
			 left join issues i on i.project_id = p.id
			 group by v.id, p.key
			 order by count(i.id) desc, p.key, v.name
			 limit 1`,
		);

		const issue = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 order by
				(select count(*) from comments c where c.issue_id = i.id) desc,
				(select count(*) from attachments a where a.issue_id = i.id) desc,
				i.key
			 limit 1`,
		);
		const attachmentIssue = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 where exists (select 1 from attachments a where a.issue_id = i.id)
			 order by (select count(*) from attachments a where a.issue_id = i.id) desc, i.key
			 limit 1`,
		);
		const epic = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 join issue_types it on it.id = i.type_id
			 where it.name = 'Epic'
			 order by i.key
			 limit 1`,
		);
		const subtask = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 join issue_types it on it.id = i.type_id
			 where it.subtask
			 order by i.key
			 limit 1`,
		);
		const serviceRequest = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 where i.request_type_id is not null
			 order by i.key
			 limit 1`,
		);

		const scrumBoard = await one<{ rapid_view_id: number }>(
			pool,
			`select b.rapid_view_id
			 from boards b
			 where b.type = 'scrum'
			   and exists (
				select 1 from sprints s
				where s.board_id = b.id and s.state = 'active'
			   )
			 order by
				(select count(*) from sprints s where s.board_id = b.id and s.state = 'active') desc,
				b.rapid_view_id
			 limit 1`,
		);
		const kanbanBoard = await one<{ rapid_view_id: number }>(
			pool,
			`select b.rapid_view_id
			 from boards b
			 where b.type = 'kanban'
			 order by (select count(*) from board_columns c where c.board_id = b.id) desc, b.rapid_view_id
			 limit 1`,
		);
		const boardIssue = await one<{ key: string }>(
			pool,
			`select i.key
			 from boards b
			 join sprints s on s.board_id = b.id and s.state = 'active'
			 join issue_sprints iss on iss.sprint_id = s.id
			 join issues i on i.id = iss.issue_id
			 where b.rapid_view_id = $1
			   and i.project_id = b.project_id
			 order by i.key
			 limit 1`,
			[scrumBoard.rapid_view_id],
		);

		const macroPage = await one<{
			id: string;
			source_id: string;
			title: string;
			space_key: string;
			version_number: number;
		}>(
			pool,
			`select p.id, p.source_id, p.title, s.key as space_key, p.version_number
			 from pages p
			 join spaces s on s.id = p.space_id
			 where p.status = 'current'
			 order by
				(coalesce(p.body_storage, '') like '%ac:structured-macro%') desc,
				(select count(*) from pages c where c.parent_id = p.id) desc,
				length(coalesce(p.body_storage, '')) desc,
				p.title
			 limit 1`,
		);
		const childPage = await one<{
			id: string;
			source_id: string;
			title: string;
		}>(
			pool,
			`select p.id, p.source_id, p.title
			 from pages p
			 where p.parent_id = $1
			   and p.status = 'current'
			   and position('/' in p.title) = 0
			 order by p.title
			 limit 1`,
			[macroPage.id],
		);
		const attachmentPage = await one<{
			id: string;
			source_id: string;
			title: string;
			version_number: number;
		}>(
			pool,
			`select p.id, p.source_id, p.title, p.version_number
			 from pages p
			 order by
				(select count(*) from page_attachments a where a.page_id = p.id) desc,
				p.title
			 limit 1`,
		);
		const attachmentVersions = await one<{ first: number; last: number }>(
			pool,
			`select min(number)::int as first, max(number)::int as last
			 from page_versions
			 where page_id = $1`,
			[attachmentPage.id],
		);
		const label = await one<{ label: string }>(
			pool,
			`select label
			 from page_labels
			 group by label
			 order by count(*) desc, label
			 limit 1`,
		);

		const ordinaryUsers = await many<{ username: string }>(
			pool,
			`select u.username
			 from users u
			 where u.active
			   and not u.is_admin
			   and not exists (
				select 1
				from permission_grants g
				join permission_schemes ps on ps.id = g.scheme_id
				where ps.name = 'Global permissions'
				  and g.permission_key = 'ADMINISTER'
				  and g.holder_type = 'user'
				  and lower(g.holder_parameter) = lower(u.username)
			   )
			 order by
				(select count(distinct pra.project_id)
				 from project_role_actors pra
				 where pra.actor_type = 'user'
				   and lower(pra.actor_parameter) = lower(u.username)) desc,
				u.username
			 limit 2`,
		);
		const ordinaryUser = ordinaryUsers[0]?.username;
		const profileUser = ordinaryUsers[1]?.username ?? ordinaryUser;
		if (!ordinaryUser || !profileUser) {
			throw new Error("no ordinary user with project membership was found");
		}

		const group = await one<{ name: string }>(
			pool,
			`select g.name
			 from groups g
			 left join user_groups ug on ug.group_id = g.id
			 group by g.name
			 order by count(ug.user_id) desc, g.name
			 limit 1`,
		);
		const customField = await one<{ id: string }>(
			pool,
			`select f.id
			 from fields f
			 where exists (select 1 from field_options o where o.field_id = f.id)
			 order by (select count(*) from field_options o where o.field_id = f.id) desc, f.name
			 limit 1`,
		);
		const workflow = await one<{ name: string }>(
			pool,
			`select w.name
			 from workflows w
			 order by (select count(*) from workflow_statuses ws where ws.workflow_id = w.id) desc, w.name
			 limit 1`,
		);
		const permissionScheme = await one<{ id: string }>(
			pool,
			`select ps.id
			 from permission_schemes ps
			 order by (select count(*) from permission_grants g where g.scheme_id = ps.id) desc, ps.name
			 limit 1`,
		);
		const dashboard = await one<{ id: string; source_id: string | null }>(
			pool,
			`select d.id, d.source_id
			 from dashboards d
			 order by (select count(*) from dashboard_gadgets g where g.dashboard_id = d.id) desc, d.name
			 limit 1`,
		);
		const sharedDashboard = await one<{ id: string; source_id: string | null }>(
			pool,
			`select d.id, d.source_id
			 from dashboards d
			 where d.shared
			 order by (select count(*) from dashboard_gadgets g where g.dashboard_id = d.id) desc, d.name
			 limit 1`,
		);
		const filter = await one<{ id: string }>(
			pool,
			`select f.id
			 from filters f
			 order by (select count(*) from filter_shares s where s.filter_id = f.id) desc, f.name
			 limit 1`,
		);

		const desk = await one<{ id: string; project_key: string }>(
			pool,
			`select d.id, p.key as project_key
			 from service_desks d
			 join projects p on p.id = d.project_id
			 order by
				(select count(*) from request_types rt where rt.desk_id = d.id) desc,
				(select count(*) from queues q where q.desk_id = d.id) desc,
				d.id
			 limit 1`,
		);
		const requestType = await one<{ id: string }>(
			pool,
			`select rt.id
			 from request_types rt
			 where rt.desk_id = $1
			 order by rt.sequence, rt.id
			 limit 1`,
			[desk.id],
		);
		const requestGroup = await one<{ id: string }>(
			pool,
			`select g.id
			 from request_type_groups g
			 where g.desk_id = $1
			 order by
				(select count(*) from request_type_group_members m where m.group_id = g.id) desc,
				g.sequence,
				g.id
			 limit 1`,
			[desk.id],
		);
		const queues = await many<{ id: string }>(
			pool,
			`select q.id
			 from queues q
			 where q.desk_id = $1
			 order by q.issue_count desc nulls last, q.sequence, q.id
			 limit 2`,
			[desk.id],
		);
		const deskRequest = await one<{ key: string }>(
			pool,
			`select i.key
			 from issues i
			 join request_types rt on rt.id = i.request_type_id
			 where rt.desk_id = $1
			 order by i.key
			 limit 1`,
			[desk.id],
		);

		const screens: Screen[] = [];
		const add = (id: string, area: Screen["area"], path: string) => {
			if (screens.some((screen) => screen.id === id)) {
				throw new Error(`duplicate screen id: ${id}`);
			}
			screens.push({ id, area, path });
		};

		// Jira, dashboards, projects, issues and boards.
		add("home", "core", "/");
		add("dashboard", "core", "/secure/Dashboard.jspa");
		add(
			"dashboard-gadgets",
			"core",
			query("/secure/Dashboard.jspa", {
				selectPageId: dashboard.source_id ?? dashboard.id,
			}),
		);
		add(
			"dashboard-shared",
			"core",
			query("/secure/Dashboard.jspa", {
				selectPageId: sharedDashboard.source_id ?? sharedDashboard.id,
			}),
		);
		add(
			"dashboard-manage",
			"core",
			"/secure/ConfigurePortalPages!default.jspa",
		);
		add("project-directory", "core", "/secure/BrowseProjects.jspa");
		add("global-search", "core", query("/search", { q: projectKey }));
		add("create-issue", "core", "/secure/CreateIssue!default.jspa");
		add("project-issues", "core", `/projects/${segment(projectKey)}/issues`);
		add("project-summary", "core", `/projects/${segment(projectKey)}/summary`);
		add("project-home", "core", `/projects/${segment(projectKey)}`);
		add("project-reports", "core", `/projects/${segment(projectKey)}/reports`);
		add(
			"project-version",
			"core",
			`/projects/${segment(version.project_key)}/versions/${segment(version.id)}`,
		);
		add(
			"project-settings",
			"core",
			`/plugins/servlet/project-config/${segment(projectKey)}/summary`,
		);
		add(
			"project-roles",
			"core",
			`/plugins/servlet/project-config/${segment(projectKey)}/roles`,
		);
		add(
			"project-workflows",
			"admin",
			`/plugins/servlet/project-config/${segment(projectKey)}/workflows`,
		);
		add("gitlab-admin", "core", "/plugins/servlet/gitlab");
		add("issue", "core", `/browse/${segment(issue.key)}`);
		add("issue-attachment", "core", `/browse/${segment(attachmentIssue.key)}`);
		add("issue-epic", "core", `/browse/${segment(epic.key)}`);
		add("issue-subtask", "core", `/browse/${segment(subtask.key)}`);
		add("service-request", "core", `/browse/${segment(serviceRequest.key)}`);
		add(
			"navigator",
			"core",
			query("/issues/", {
				jql: `project = ${projectKey} ORDER BY key ASC`,
			}),
		);
		add(
			"navigator-list",
			"core",
			query("/issues/", {
				jql: `project = ${projectKey} ORDER BY key ASC`,
				view: "list",
			}),
		);
		add(
			"navigator-detail",
			"core",
			query("/issues/", {
				jql: `project = ${projectKey} ORDER BY key ASC`,
				view: "detail",
			}),
		);
		add(
			"issue-navigator",
			"core",
			query("/secure/IssueNavigator.jspa", {
				jql: `project = ${projectKey} ORDER BY key ASC`,
			}),
		);
		add(
			"issue-navigator-detail",
			"core",
			query("/secure/IssueNavigator.jspa", {
				jql: `project = ${projectKey} ORDER BY key ASC`,
				view: "detail",
			}),
		);
		add("saved-filter", "core", query("/issues/", { filter: filter.id }));
		add("manage-filters", "core", "/secure/ManageFilters.jspa");
		add("manage-boards", "core", "/secure/ManageRapidViews.jspa");
		add(
			"board-work",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: scrumBoard.rapid_view_id,
			}),
		);
		add(
			"board-planning",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: scrumBoard.rapid_view_id,
				view: "planning",
			}),
		);
		add(
			"board-reporting",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: scrumBoard.rapid_view_id,
				view: "reporting",
			}),
		);
		add(
			"board-releases",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: scrumBoard.rapid_view_id,
				view: "releases",
			}),
		);
		add(
			"board-selected-issue",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: scrumBoard.rapid_view_id,
				selectedIssue: boardIssue.key,
			}),
		);
		add(
			"board-kanban",
			"core",
			query("/secure/RapidBoard.jspa", {
				rapidView: kanbanBoard.rapid_view_id,
			}),
		);
		for (const tab of [
			"general",
			"columns",
			"swimlanes",
			"quick-filters",
			"card-colours",
			"estimation",
		]) {
			add(
				`board-config-${tab}`,
				"core",
				query("/secure/RapidView.jspa", {
					rapidView: scrumBoard.rapid_view_id,
					tab,
				}),
			);
		}
		add("profile", "core", "/secure/ViewProfile.jspa");
		add(
			"profile-tokens",
			"core",
			query("/secure/ViewProfile.jspa", { selectedTab: "tokens" }),
		);
		add(
			"profile-notifications",
			"core",
			query("/secure/ViewProfile.jspa", {
				selectedTab: "notifications",
			}),
		);
		add(
			"profile-password",
			"core",
			query("/secure/ViewProfile.jspa", { selectedTab: "password" }),
		);
		add(
			"profile-other",
			"core",
			query("/secure/ViewProfile.jspa", { name: profileUser }),
		);

		// Wiki.
		add("wiki-home", "wiki", "/wiki");
		add("wiki-dashboard", "wiki", "/dashboard.action");
		add("wiki-spaces", "wiki", "/spacedirectory/view.action");
		add("wiki-space", "wiki", `/display/${segment(macroPage.space_key)}`);
		add(
			"wiki-space-overview",
			"wiki",
			`/spaces/${segment(macroPage.space_key)}/overview`,
		);
		add(
			"wiki-page-title",
			"wiki",
			`/display/${segment(macroPage.space_key)}/${segment(macroPage.title)}`,
		);
		add(
			"wiki-page-path",
			"wiki",
			`/spaces/${segment(macroPage.space_key)}/pages/${segment(macroPage.source_id)}/${segment(macroPage.title)}`,
		);
		add(
			"wiki-page-view",
			"wiki",
			query("/pages/viewpage.action", { pageId: macroPage.source_id }),
		);
		add(
			"wiki-page-version",
			"wiki",
			query("/pages/viewpage.action", {
				pageId: attachmentPage.source_id,
				pageVersion: attachmentVersions.first,
			}),
		);
		add(
			"wiki-page-attachments",
			"wiki",
			query("/pages/viewpageattachments.action", {
				pageId: attachmentPage.source_id,
			}),
		);
		add(
			"wiki-page-history",
			"wiki",
			query("/pages/viewpreviousversions.action", {
				pageId: attachmentPage.source_id,
			}),
		);
		add(
			"wiki-page-diff",
			"wiki",
			`${query("/pages/diffpagesbyversion.action", {
				pageId: attachmentPage.source_id,
				selectedPageVersions: attachmentVersions.first,
			})}&selectedPageVersions=${attachmentVersions.last}`,
		);
		add("wiki-label", "wiki", `/label/${segment(label.label)}`);
		add(
			"wiki-search",
			"wiki",
			query("/dosearchsite.action", {
				queryString: macroPage.space_key,
			}),
		);
		add(
			"wiki-search-space",
			"wiki",
			query("/dosearchsite.action", {
				queryString: macroPage.space_key,
				space: macroPage.space_key,
			}),
		);
		add(
			"wiki-create-page",
			"wiki",
			query("/pages/createpage.action", {
				spaceKey: macroPage.space_key,
				fromPageId: macroPage.source_id,
			}),
		);
		add(
			"wiki-edit-page",
			"wiki",
			query("/pages/editpage.action", { pageId: macroPage.source_id }),
		);
		add("wiki-resume-draft", "wiki", "/pages/resumedraft.action");
		add(
			"wiki-copy-page",
			"wiki",
			query("/pages/copypage.action", {
				idOfPageToCopy: macroPage.source_id,
			}),
		);
		add(
			"wiki-move-page",
			"wiki",
			query("/pages/movepage.action", { pageId: macroPage.source_id }),
		);
		add(
			"wiki-remove-page",
			"wiki",
			query("/pages/removepage.action", { pageId: macroPage.source_id }),
		);
		add(
			"wiki-trash",
			"wiki",
			query("/pages/viewtrash.action", { key: macroPage.space_key }),
		);
		add("wiki-create-space", "wiki", "/spaces/createspace.action");
		add(
			"wiki-child-page-title",
			"wiki",
			`/display/${segment(macroPage.space_key)}/${segment(childPage.title)}`,
		);
		add(
			"wiki-child-page-path",
			"wiki",
			`/spaces/${segment(macroPage.space_key)}/pages/${segment(childPage.source_id)}/${segment(childPage.title)}`,
		);

		// Administration.
		add("admin-projects", "admin", "/secure/project/ViewProjects.jspa");
		add("admin-issue-types", "admin", "/secure/admin/ViewIssueTypes.jspa");
		add(
			"admin-workflows",
			"admin",
			"/secure/admin/workflows/ListWorkflows.jspa",
		);
		add(
			"admin-workflow-text",
			"admin",
			query("/secure/admin/workflows/ViewWorkflowSteps.jspa", {
				workflowName: workflow.name,
				mode: "text",
			}),
		);
		add(
			"admin-workflow-diagram",
			"admin",
			query("/secure/admin/workflows/ViewWorkflowSteps.jspa", {
				workflowName: workflow.name,
				mode: "diagram",
			}),
		);
		add("admin-statuses", "admin", "/secure/admin/ViewStatuses.jspa");
		add("admin-resolutions", "admin", "/secure/admin/ViewResolutions.jspa");
		add("admin-priorities", "admin", "/secure/admin/ViewPriorities.jspa");
		add(
			"admin-link-types",
			"admin",
			"/secure/admin/ViewLinkTypes!default.jspa",
		);
		add("admin-custom-fields", "admin", "/secure/admin/ViewCustomFields.jspa");
		add(
			"admin-custom-field",
			"admin",
			query("/secure/admin/ConfigureCustomField!default.jspa", {
				id: customField.id,
			}),
		);
		add("admin-users", "admin", "/secure/admin/user/UserBrowser.jspa");
		add(
			"admin-user",
			"admin",
			query("/secure/admin/user/ViewUser.jspa", { name: ordinaryUser }),
		);
		add("admin-groups", "admin", "/secure/admin/user/GroupBrowser.jspa");
		add(
			"admin-group",
			"admin",
			query("/secure/admin/user/ViewGroup.jspa", { name: group.name }),
		);
		add(
			"admin-permission-schemes",
			"admin",
			"/secure/admin/ViewPermissionSchemes.jspa",
		);
		add(
			"admin-permission-scheme",
			"admin",
			query("/secure/admin/ViewPermissionScheme.jspa", {
				id: permissionScheme.id,
			}),
		);
		add(
			"admin-general",
			"admin",
			"/secure/admin/ViewApplicationProperties.jspa",
		);
		add(
			"admin-global-permissions",
			"admin",
			"/secure/admin/ViewGlobalPermissions.jspa",
		);
		add("admin-audit-log", "admin", "/secure/admin/ViewAuditLog.jspa");
		add("admin-system-info", "admin", "/secure/admin/ViewSystemInfo.jspa");

		// Service desk.
		add("portals", "servicedesk", "/servicedesk/customer/portals");
		add(
			"portal-home",
			"servicedesk",
			`/servicedesk/customer/portal/${segment(desk.id)}`,
		);
		add(
			"portal-group",
			"servicedesk",
			`/servicedesk/customer/portal/${segment(desk.id)}/group/${segment(requestGroup.id)}`,
		);
		add(
			"portal-create",
			"servicedesk",
			`/servicedesk/customer/portal/${segment(desk.id)}/create/${segment(requestType.id)}`,
		);
		add(
			"portal-request",
			"servicedesk",
			`/servicedesk/customer/portal/${segment(desk.id)}/${segment(deskRequest.key)}`,
		);
		add("my-requests", "servicedesk", "/servicedesk/customer/user/requests");
		add(
			"service-desk-issues",
			"servicedesk",
			`/projects/${segment(desk.project_key)}/issues`,
		);
		add(
			"service-desk-summary",
			"servicedesk",
			`/projects/${segment(desk.project_key)}/summary`,
		);
		add(
			"service-desk-home",
			"servicedesk",
			`/projects/${segment(desk.project_key)}`,
		);
		add(
			"service-desk-queues",
			"servicedesk",
			`/projects/${segment(desk.project_key)}/queues`,
		);
		if (queues[0]) {
			add(
				"service-desk-queue",
				"servicedesk",
				`/projects/${segment(desk.project_key)}/queues/custom/${segment(queues[0].id)}`,
			);
		}
		if (queues[1]) {
			add(
				"service-desk-queue-2",
				"servicedesk",
				`/projects/${segment(desk.project_key)}/queues/custom/${segment(queues[1].id)}`,
			);
		}
		add(
			"service-desk-reports",
			"servicedesk",
			`/projects/${segment(desk.project_key)}/reports`,
		);

		if (screens.length < 80 || screens.length > 120) {
			throw new Error(`expected 80 to 120 screens, resolved ${screens.length}`);
		}

		return {
			database: databaseName(connectionString),
			screens,
			context: {
				project: projectKey,
				issue: issue.key,
				epic: epic.key,
				subtask: subtask.key,
				board: scrumBoard.rapid_view_id,
				kanbanBoard: kanbanBoard.rapid_view_id,
				wikiSpace: macroPage.space_key,
				wikiPage: macroPage.source_id,
				wikiChildPage: childPage.source_id,
				wikiAttachmentPage: attachmentPage.source_id,
				deskProject: desk.project_key,
				ordinaryUser,
				profileUser,
			},
		};
	} finally {
		await pool.end();
	}
}
