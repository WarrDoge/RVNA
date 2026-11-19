/** API response types shared by the pages and the components. */

export type Me = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	groups: string[];
	isAdmin: boolean;
	mustChangePassword: boolean;
	hasPassword: boolean;
};

export type ApiToken = {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
};

export type CreatedApiToken = ApiToken & { token: string };

export type UserRef = {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
};

export type UserWithEmail = UserRef & { email: string | null };

export type StatusCategory = "new" | "indeterminate" | "done";

export type StatusRef = {
	id: string;
	name: string;
	category: StatusCategory;
};

export type PriorityRef = {
	id: string;
	name: string;
	iconColor: string | null;
	iconUrl?: string | null;
};

export type IssueTypeRef = {
	id: string;
	name: string;
	subtask: boolean;
	iconUrl?: string | null;
};

export type ResolutionRef = { id: string; name: string };

export type ProjectType = "software" | "service_desk";

export type ProjectRef = {
	id: string;
	key: string;
	name: string;
	avatarUrl: string | null;
	type: ProjectType;
};

export type ProjectSummary = ProjectRef & {
	description: string | null;
	lead: UserRef | null;
	category: string | null;
	issueCount: number;
	archived: boolean;
	permissions: Record<string, boolean>;
};

export type Component = {
	id: string;
	name: string;
	description: string | null;
	lead: UserRef | null;
};

export type Version = {
	id: string;
	name: string;
	description: string | null;
	released: boolean;
	archived: boolean;
	startDate: string | null;
	releaseDate: string | null;
};

export type Workflow = {
	id: string;
	name: string;
	statuses: StatusRef[];
};

export type ProjectIssueType = IssueTypeRef & {
	iconUrl: string | null;
	workflow: Workflow | null;
};

export type ProjectDetail = ProjectSummary & {
	issueTypes: ProjectIssueType[];
	components: Component[];
	versions: Version[];
	priorities: PriorityRef[];
};

export type ProjectIssue = {
	id: string;
	key: string;
	summary: string;
	type: IssueTypeRef;
	status: StatusRef;
	priority: PriorityRef | null;
	resolution: ResolutionRef | null;
	assignee: UserRef | null;
	reporter: UserRef | null;
	created: string | null;
	updated: string | null;
};

export type ProjectIssueList = {
	issues: ProjectIssue[];
	total: number;
	offset: number;
	limit: number;
};

export type IssueRef = {
	id: string;
	key: string;
	summary: string;
	type: IssueTypeRef;
	status: StatusRef;
	priority: PriorityRef | null;
	assignee: UserRef | null;
};

export type Attachment = {
	id: string;
	fileName: string;
	mimeType: string | null;
	size: number;
	author: UserRef | null;
	created: string | null;
};

export type LinkType = {
	id: string;
	name: string;
	inward: string;
	outward: string;
};

export type IssueLinkGroup = {
	type: LinkType;
	direction: "inward" | "outward";
	links: { id: string; issue: IssueRef }[];
};

export type Transition = {
	id: string;
	name: string;
	asksResolution: boolean;
	to: StatusRef;
};

export type CustomField = {
	id: string;
	name: string;
	value: string;
};

export type CustomFieldOption = {
	id: string;
	value: string;
	disabled: boolean;
	children: CustomFieldOption[];
};

/** A configurable custom field, without the value an issue stores for it. */
export type CustomFieldSpec = {
	id: string;
	name: string;
	description: string | null;
	type: string;
	required: boolean;
	options: CustomFieldOption[];
};

/** A configurable custom field on one issue; `value` is the stored JSON. */
export type EditableCustomField = CustomFieldSpec & { value: unknown };

export type IssueDetail = {
	id: string;
	key: string;
	number: number;
	summary: string;
	descriptionHtml: string | null;
	project: ProjectRef;
	type: IssueTypeRef;
	status: StatusRef;
	priority: PriorityRef | null;
	resolution: ResolutionRef | null;
	reporter: UserRef | null;
	assignee: UserRef | null;
	creator: UserRef | null;
	parent: IssueRef | null;
	subtasks: IssueRef[];
	epic: IssueRef | null;
	epicIssues: IssueRef[];
	labels: string[];
	components: { id: string; name: string }[];
	fixVersions: { id: string; name: string }[];
	affectsVersions: { id: string; name: string }[];
	links: IssueLinkGroup[];
	attachments: Attachment[];
	watchers: { count: number; watching: boolean };
	timeTracking: {
		originalEstimate: number | null;
		remainingEstimate: number | null;
		timeSpent: number | null;
	};
	storyPoints: number | null;
	dueDate: string | null;
	created: string | null;
	updated: string | null;
	resolved: string | null;
	customFields: CustomField[];
	editableCustomFields: EditableCustomField[];
	transitions: Transition[];
	permissions: Record<string, boolean>;
};

export type Comment = {
	id: string;
	author: UserRef | null;
	bodyHtml: string | null;
	created: string | null;
	updated: string | null;
	internal: boolean;
};

export type HistoryItem = {
	field: string;
	fieldType: string | null;
	from?: string | null;
	fromText: string | null;
	to?: string | null;
	toText: string | null;
};

export type HistoryEntry = {
	id: string;
	author: UserRef | null;
	created: string | null;
	via: string | null;
	items: HistoryItem[];
};

export type Worklog = {
	id: string;
	author: UserRef | null;
	started: string | null;
	seconds: number;
	comment: string | null;
};

export type NavigatorIssue = {
	id: string;
	key: string;
	summary: string;
	type: IssueTypeRef;
	status: StatusRef;
	priority: PriorityRef | null;
	resolution: ResolutionRef | null;
	assignee: UserRef | null;
	reporter: UserRef | null;
	creator: UserRef | null;
	project: { key: string; name: string };
	created: string | null;
	updated: string | null;
	resolved: string | null;
	dueDate: string | null;
	labels: string[];
	components: string[];
	fixVersions: string[];
	affectsVersions: string[];
	sprint: string | null;
	epic: { key: string; summary: string } | null;
	parent: { key: string; summary: string } | null;
	storyPoints: number | null;
	timeSpent: number | null;
	originalEstimate: number | null;
	remainingEstimate: number | null;
	custom: Record<string, string>;
};

export type NavigatorPage = {
	startAt: number;
	maxResults: number;
	total: number;
	issues: NavigatorIssue[];
};

export type Filter = {
	id: string;
	name: string;
	description: string | null;
	jql: string;
	columns: string[];
	shared: boolean;
	owner: UserRef;
	favourite: boolean;
	favouriteCount: number;
	canEdit: boolean;
	sharedWith: { projectIds: string[]; groups: string[] };
	createdAt: string;
	updatedAt: string;
};

export type RecentIssue = {
	id: string;
	key: string;
	summary: string;
	type: IssueTypeRef;
	status: StatusRef;
	viewedAt: string;
};

export type QuickSearchResult = {
	issues: {
		id: string;
		key: string;
		summary: string;
		type: IssueTypeRef;
		status: StatusRef;
	}[];
	projects: { key: string; name: string; avatarUrl: string | null }[];
	pages: {
		id: string;
		title: string;
		spaceKey: string;
		spaceName: string;
	}[];
};

export type CustomFieldColumn = {
	id: string;
	name: string;
	jql: string;
	kind: "text" | "number" | "date" | "datetime" | "list";
};

export type NavigatorPreferences = {
	view: "list" | "detail";
	columns: string[];
};

export type Notification = {
	id: string;
	actor: UserRef | null;
	kind: string;
	action: string;
	issue: { id: string | null; key: string; summary: string };
	direct: boolean;
	read: boolean;
	created: string;
};

export type NotificationList = {
	notifications: Notification[];
	total: number;
	unread: number;
	offset: number;
	limit: number;
};

export type NotificationSettings = {
	emailNotifications: boolean;
	notifyOwnChanges: boolean;
	autoWatch: boolean;
	emailFormat: "html" | "text";
};

export type BoardProject = { id: string; key: string; name: string };

export type BoardRef = {
	id: string;
	rapidViewId: number;
	name: string;
	type: "scrum" | "kanban";
	project: BoardProject | null;
	owner: UserRef | null;
	configImported: boolean;
};

export type BoardListEntry = BoardRef & { canAdminister: boolean };

export type BoardColumn = {
	id: string;
	name: string;
	sequence: number;
	minIssues: number | null;
	maxIssues: number | null;
	statuses: StatusRef[];
};

export type BoardSwimlane = {
	id: string;
	name: string;
	jql: string;
	sequence: number;
};

export type BoardQuickFilter = {
	id: string;
	name: string;
	jql: string;
	sequence: number;
};

export type EstimationField =
	| "story_points"
	| "original_estimate"
	| "issue_count";

export type SwimlaneStrategy = "none" | "assignee" | "epic" | "queries";

export type CardColourStrategy =
	| "none"
	| "priority"
	| "assignee"
	| "epic"
	| "issue_type";

export type BoardConfig = BoardRef & {
	filterJql: string;
	estimationField: EstimationField;
	swimlaneStrategy: SwimlaneStrategy;
	cardColourStrategy: CardColourStrategy;
	subFilterJql: string | null;
	kanbanBacklogStatus: StatusRef | null;
	columns: BoardColumn[];
	swimlanes: BoardSwimlane[];
	quickFilters: BoardQuickFilter[];
	availableStatuses: StatusRef[];
};

export type Sprint = {
	id: string;
	name: string;
	goal: string | null;
	state: "future" | "active" | "closed";
	startDate: string | null;
	endDate: string | null;
	completeDate: string | null;
	sequence: number;
};

export type BoardIssue = {
	id: string;
	key: string;
	summary: string;
	type: IssueTypeRef;
	status: StatusRef;
	priority: PriorityRef | null;
	assignee: UserRef | null;
	epic: { key: string; summary: string; colour: string | null } | null;
	estimate: number | null;
	flagged: boolean;
	rank: string | null;
	sprintId: string | null;
	columnId: string | null;
};

export type BoardFilters = {
	quickFilter?: string;
	text?: string;
	epic?: string;
	version?: string;
	assignee?: string;
};

export type BoardData = {
	board: BoardConfig;
	activeSprint: Sprint | null;
	columns: BoardColumn[];
	swimlanes: { id: string; name: string | null; issues: BoardIssue[] }[];
	quickFilters: BoardQuickFilter[];
	total: number;
};

export type EstimateTotals = {
	new: number;
	indeterminate: number;
	done: number;
};

export type BacklogData = {
	board: BoardConfig;
	sprints: (Sprint & { issues: BoardIssue[]; totals: EstimateTotals })[];
	backlog: { issues: BoardIssue[]; totals: EstimateTotals };
	epics: {
		key: string;
		summary: string;
		colour: string | null;
		issueCount: number;
		doneCount: number;
	}[];
	versions: {
		id: string;
		name: string;
		released: boolean;
		issueCount: number;
	}[];
	quickFilters: BoardQuickFilter[];
};

export type SprintComplete = {
	sprint: Sprint;
	completed: number;
	incomplete: number;
	movedToSprintId: string | null;
};

export type DevelopmentRepository = {
	id: string;
	path: string;
	webUrl: string;
};

export type DevelopmentBranch = {
	id: string;
	name: string;
	webUrl: string | null;
	updatedAt: string;
	repository: DevelopmentRepository;
};

export type DevelopmentCommit = {
	id: string;
	sha: string;
	title: string;
	webUrl: string | null;
	authorName: string | null;
	committedAt: string | null;
	repository: DevelopmentRepository;
};

export type DevelopmentMergeRequest = {
	id: string;
	iid: number;
	title: string;
	state: string;
	lozenge: "OPEN" | "MERGED" | "DECLINED" | null;
	approvals: number;
	authorName: string | null;
	webUrl: string | null;
	updatedAt: string;
	repository: DevelopmentRepository;
};

export type IssueDevelopment = {
	counts: { branches: number; commits: number; mergeRequests: number };
	mergeRequestState: "OPEN" | "MERGED" | "DECLINED" | null;
	latestPipeline: {
		id: string;
		status: string;
		ref: string | null;
		webUrl: string | null;
		createdAt: string;
	} | null;
	latestCommit: {
		sha: string;
		title: string;
		webUrl: string | null;
		committedAt: string | null;
	} | null;
	createBranch: { name: string; url: string } | null;
	branches: DevelopmentBranch[];
	commits: DevelopmentCommit[];
	mergeRequests: DevelopmentMergeRequest[];
};

export type GitlabSettings = {
	baseUrl: string;
	webhookUrl: string;
	hasWebhookSecret: boolean;
	hasAccessToken: boolean;
	lastDeliveryAt: string | null;
	lastDeliveryStatus: string | null;
	secretsKeyConfigured: boolean;
};

export type ProjectGitlabSettings = {
	repositories: {
		id: string;
		path: string;
		webUrl: string;
		linked: boolean;
	}[];
	linkedRepositoryIds: string[];
	defaultRepositoryId: string | null;
	smartCommitsEnabled: boolean;
	mergeRequestOpenedEnabled: boolean;
	mergeRequestOpenedTransitions: string[];
	mergeRequestMergedEnabled: boolean;
	mergeRequestMergedTransitions: string[];
	availableTransitions: string[];
};

export type ReportSprint = Sprint & { sequence: number };

export type ReportBoard = {
	rapidViewId: number;
	name: string;
	type: "scrum" | "kanban";
	estimationField?: EstimationField;
};

export type ReportIssue = {
	id: string;
	key: string;
	summary: string;
	typeName: string;
	status: StatusRef;
	assignee: string | null;
	estimate: number;
	created: string | null;
};

export type BurndownEventRow = {
	at: string;
	issueKey: string;
	issueSummary: string;
	eventType:
		| "scope-added"
		| "scope-removed"
		| "completed"
		| "reopened"
		| "estimate-changed";
	increase: number;
	decrease: number;
	remaining: number;
};

export type BurndownData = {
	points: { at: string; remaining: number }[];
	guideline: { at: string; remaining: number }[];
	eventRows: BurndownEventRow[];
	nonWorkingDays: string[];
	initialScope: number;
	remainingAtEnd: number;
	totalIncrease: number;
	totalDecrease: number;
};

export type BurndownPayload = {
	board: ReportBoard;
	sprint: ReportSprint;
	estimation: EstimationField;
	sprints: ReportSprint[];
} & BurndownData;

export type SprintReportRow = {
	issue: ReportIssue;
	estimateAtStart: number;
	estimateAtEnd: number;
	estimateAtRemoval: number;
	statusAtEnd: StatusCategory;
	addedDuringSprint: boolean;
	completedAt: string | null;
};

export type SprintReportSums = {
	completedInitial: number;
	completedCurrent: number;
	notCompletedInitial: number;
	notCompletedCurrent: number;
	removedInitial: number;
	removedCurrent: number;
	totalInitial: number;
	totalCurrent: number;
};

export type SprintReportPayload = {
	board: ReportBoard;
	sprint: ReportSprint;
	estimation: EstimationField;
	sprints: ReportSprint[];
	burndown: BurndownData;
	completed: SprintReportRow[];
	notCompleted: SprintReportRow[];
	removed: SprintReportRow[];
	addedDuringSprint: string[];
	sums: SprintReportSums;
};

export type VelocitySprint = {
	id: string;
	name: string;
	startDate: string | null;
	endDate: string | null;
	completeDate: string | null;
	commitment: number;
	completed: number;
};

export type VelocityPayload = {
	board: ReportBoard;
	estimation: EstimationField;
	sprints: VelocitySprint[];
	averageCompleted: number;
	averageCommitment: number;
};

export type CumulativeFlowPayload = {
	board: ReportBoard;
	from: string;
	to: string;
	columns: {
		id: string;
		name: string;
		sequence: number;
		statusIds: string[];
	}[];
	assignees: string[];
	dates: string[];
	series: { columnId: string; name: string; values: number[] }[];
	total: number[];
};

export type ReleaseSummary = {
	id: string;
	name: string;
	description: string | null;
	released: boolean;
	archived: boolean;
	startDate: string | null;
	releaseDate: string | null;
	counts: EstimateTotals;
	total: number;
};

export type ReleasesPayload = {
	project: { key: string; name: string };
	versions: ReleaseSummary[];
};

export type VersionIssue = {
	id: string;
	key: string;
	summary: string;
	typeName: string;
	status: StatusRef;
	assignee: string | null;
};

export type VersionDetailPayload = {
	project: { key: string; name: string };
	version: ReleaseSummary;
	issues: VersionIssue[];
};

export type Profile = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string;
	groups: string[];
	timeZone: string | null;
	assignedOpenIssues: number;
	isSelf: boolean;
	canEditAvatar: boolean;
};
