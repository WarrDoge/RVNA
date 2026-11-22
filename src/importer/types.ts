export interface JiraUser {
	key?: string;
	name: string;
	emailAddress?: string | null;
	displayName: string;
	active?: boolean;
	deleted?: boolean;
	avatarUrls?: Record<string, string>;
	timeZone?: string | null;
}

export interface JiraIssueType {
	id: string;
	name: string;
	description?: string | null;
	subtask?: boolean;
	iconUrl?: string | null;
}

export interface JiraPriority {
	id: string;
	name: string;
	statusColor?: string | null;
	iconUrl?: string | null;
}

export interface JiraResolution {
	id: string;
	name: string;
	description?: string | null;
}

export interface JiraStatus {
	id: string;
	name: string;
	description?: string | null;
	statusCategory?: {
		key?: string;
		colourName?: string;
		name?: string;
	};
}

export interface JiraLinkType {
	id: string;
	name: string;
	inward: string;
	outward: string;
}

export interface JiraField {
	id: string;
	name: string;
	custom?: boolean;
	schema?: {
		type?: string;
		custom?: string;
		items?: string;
	};
}

export interface JiraFieldOption {
	id: string;
	value: string;
	disabled?: boolean;
	children?: JiraFieldOption[];
}

export interface JiraCreateMetaField {
	fieldId: string;
	name: string;
	schema?: {
		type?: string;
		custom?: string;
		items?: string;
	};
	allowedValues?: JiraFieldOption[];
}

export interface JiraWorkflow {
	name: string;
	description?: string | null;
	isDefault?: boolean;
}

export interface JiraWorkflowLayoutStatus {
	id: string;
	name: string;
	statusId?: string | null;
	statusCategory?: {
		key?: string;
		colourName?: string;
	};
}

export interface JiraWorkflowLayoutTransition {
	id: string;
	name: string;
	sourceId: string;
	targetId: string;
	globalTransition?: boolean;
	initial?: boolean;
	screenId?: number | null;
	screenName?: string | null;
	/** Set by the importer after it reads the transition's screen. */
	hasResolutionField?: boolean;
}

export interface JiraScreenTab {
	id: number | string;
	name?: string;
}

export interface JiraScreenField {
	id: string;
	name?: string;
}

export interface JiraWorkflowLayout {
	layout: {
		statuses: JiraWorkflowLayoutStatus[];
		transitions: JiraWorkflowLayoutTransition[];
	};
}

export interface JiraProjectCategory {
	id: string;
	name: string;
	description?: string | null;
}

export interface JiraProject {
	id: string;
	key: string;
	name: string;
	description?: string | null;
	lead?: JiraUser | null;
	avatarUrls?: Record<string, string>;
	projectTypeKey?: string;
	archived?: boolean;
	projectCategory?: JiraProjectCategory | null;
}

export interface JiraProjectDetail extends JiraProject {
	issueTypes?: JiraIssueType[];
	components?: JiraComponent[];
	versions?: JiraVersion[];
}

export interface JiraProjectStatuses {
	id: string;
	name: string;
	subtask?: boolean;
	statuses: JiraStatus[];
}

export interface JiraComponent {
	id: string;
	name: string;
	description?: string | null;
	lead?: JiraUser | null;
}

export interface JiraVersion {
	id: string;
	name: string;
	description?: string | null;
	startDate?: string | null;
	releaseDate?: string | null;
	released?: boolean;
	archived?: boolean;
}

export interface JiraIssueRef {
	id?: string;
	key: string;
	fields?: {
		summary?: string;
	};
}

export interface JiraAttachment {
	id: string;
	filename: string;
	mimeType?: string | null;
	size?: number;
	author?: JiraUser | null;
	created?: string;
	content: string;
	thumbnail?: string;
}

export interface JiraIssueLink {
	id: string;
	type: {
		id: string;
		name: string;
		inward?: string;
		outward?: string;
	};
	outwardIssue?: JiraIssueRef;
	inwardIssue?: JiraIssueRef;
}

export interface JiraComment {
	id: string;
	author?: JiraUser | null;
	updateAuthor?: JiraUser | null;
	body?: string | null;
	renderedBody?: string | null;
	created?: string;
	updated?: string;
	properties?: {
		key: string;
		value?: {
			internal?: boolean;
		};
	}[];
}

export interface JiraCommentsPage {
	comments?: JiraComment[];
	total?: number;
	maxResults?: number;
	startAt?: number;
}

export interface JiraWorklog {
	id: string;
	author?: JiraUser | null;
	started?: string;
	timeSpentSeconds?: number;
	comment?: string | null;
}

export interface JiraWorklogsPage {
	worklogs?: JiraWorklog[];
	total?: number;
	maxResults?: number;
	startAt?: number;
}

export interface JiraHistoryItem {
	field?: string;
	fieldtype?: string;
	from?: unknown;
	fromString?: string | null;
	to?: unknown;
	toString?: string | null;
}

export interface JiraHistory {
	id: string;
	author?: JiraUser | null;
	created?: string;
	items?: JiraHistoryItem[];
}

export interface JiraChangelog {
	total?: number;
	histories?: JiraHistory[];
}

export interface JiraRenderedFields {
	description?: string | null;
	comment?: {
		comments?: {
			id?: string;
			body?: string | null;
		}[];
	};
}

export interface JiraIssueFields {
	summary: string;
	description?: string | null;
	environment?: string | null;
	created?: string;
	updated?: string;
	resolutiondate?: string | null;
	duedate?: string | null;
	timeoriginalestimate?: number | null;
	timeestimate?: number | null;
	timespent?: number | null;
	labels?: string[];
	components?: JiraComponent[];
	fixVersions?: JiraVersion[];
	versions?: JiraVersion[];
	issuetype: JiraIssueType;
	status: JiraStatus;
	priority?: JiraPriority | null;
	resolution?: JiraResolution | null;
	project: JiraProject;
	reporter?: JiraUser | null;
	assignee?: JiraUser | null;
	creator?: JiraUser | null;
	parent?: JiraIssueRef | null;
	subtasks?: JiraIssueRef[];
	issuelinks?: JiraIssueLink[];
	attachment?: JiraAttachment[];
	comment?: JiraCommentsPage;
	worklog?: JiraWorklogsPage;
	watches?: {
		watchCount?: number;
		self?: string;
	};
	[customField: `customfield_${string}`]: unknown;
}

export interface JiraIssue {
	id: string;
	key: string;
	fields: JiraIssueFields;
	renderedFields?: JiraRenderedFields;
	changelog?: JiraChangelog;
}

export interface ImportedAttachment extends JiraAttachment {
	storagePath: string;
	sha256: string;
}

export interface JiraIssueData {
	issue: JiraIssue;
	comments: JiraComment[];
	worklogs: JiraWorklog[];
	watchers: JiraUser[];
	histories: JiraHistory[];
	attachments: ImportedAttachment[];
	/** Service desk requests only: SLA cycles as Jira reports them. */
	sla?: JiraRequestSla | null;
	/** Service desk requests only: portal, email, agent or api. */
	channel?: string | null;
}

export interface JiraProjectData {
	project: JiraProjectDetail;
	issueTypes: JiraIssueType[];
	components: JiraComponent[];
	versions: JiraVersion[];
	statusesByIssueType: JiraProjectStatuses[];
}

export interface JiraWorkflowData extends JiraWorkflow {
	layout: JiraWorkflowLayout["layout"];
}

export interface JiraFieldOptions {
	fieldId: string;
	options: JiraFieldOption[];
}

export interface JiraServiceDeskRef {
	id: string;
	projectId: string;
	projectName: string;
	projectKey: string;
	_links?: { portal?: string };
}

export interface JiraPortal {
	id: number | string;
	name: string;
	description?: string | null;
}

export interface JiraRequestTypeGroup {
	id: string;
	name: string;
}

export interface JiraRequestTypeIcon {
	id?: string;
	_links?: { iconUrls?: Record<string, string> };
}

export interface JiraRequestType {
	id: string;
	name: string;
	description?: string | null;
	helpText?: string | null;
	serviceDeskId?: string;
	groupIds?: string[];
	icon?: JiraRequestTypeIcon;
}

export interface JiraRequestTypeFieldValue {
	value: string;
	label: string;
	children?: JiraRequestTypeFieldValue[];
}

export interface JiraRequestTypeField {
	fieldId: string;
	name: string;
	description?: string | null;
	required?: boolean;
	validValues?: JiraRequestTypeFieldValue[];
	jiraSchema?: Record<string, unknown>;
	hidden?: boolean;
	value?: unknown;
}

export interface JiraRequestTypeFields {
	requestTypeFields: JiraRequestTypeField[];
	canRaiseOnBehalfOf?: boolean;
	canAddRequestParticipants?: boolean;
}

export interface JiraQueue {
	id: string;
	name: string;
	jql: string;
	fields?: string[];
	issueCount?: number;
}

export interface JiraSlaCondition {
	pluginKey?: string;
	factoryKey?: string;
	conditionId?: string;
	type?: string;
	name?: string;
	missing?: boolean;
}

export interface JiraSlaGoal {
	id: number;
	jqlQuery?: string;
	duration?: number;
	calendarId: number;
	defaultGoal?: boolean;
	timeMetricId?: number;
}

export interface JiraSlaMetric {
	projectKey: string;
	id: number;
	name: string;
	customerVisible?: boolean;
	customFieldId?: number;
	config?: {
		definition?: {
			start?: JiraSlaCondition[];
			pause?: JiraSlaCondition[];
			stop?: JiraSlaCondition[];
		};
		goals?: JiraSlaGoal[];
	};
}

export interface JiraSlaMetricsResponse {
	timeMetrics?: JiraSlaMetric[];
	calendarRefs?: { id: number; name: string; default?: boolean }[];
}

export interface JiraWorkingTime {
	weekday: string;
	start: number;
	end: number;
	disabled?: boolean;
}

export interface JiraWorkingHoliday {
	id?: string;
	name?: string;
	date?: string;
	startDate?: string;
	endDate?: string;
	recurring?: boolean;
}

export interface JiraWorkingCalendar {
	id: number;
	name: string;
	description?: string | null;
	timezoneId: string;
	context?: { owner?: string; serviceDeskId?: string };
	holidays?: JiraWorkingHoliday[];
	workingTimes?: JiraWorkingTime[];
}

export interface JiraWorkingCalendarList {
	calendars?: JiraWorkingCalendar[];
}

export interface JiraAutomationRule {
	id: number;
	name: string;
	state?: string;
	trigger?: Record<string, unknown>;
	conditions?: Record<string, unknown>[];
	components?: Record<string, unknown>[];
	projects?: { projectId: string; projectTypeKey?: string }[];
	[key: string]: unknown;
}

export interface JiraTime {
	iso8601?: string;
	jira?: string;
	epochMillis?: number;
}

export interface JiraSlaCycle {
	startTime?: JiraTime;
	stopTime?: JiraTime;
	breached?: boolean;
	goalDuration?: { millis?: number };
	elapsedTime?: { millis?: number };
	remainingTime?: { millis?: number };
	paused?: boolean;
}

export interface JiraRequestSlaMetric {
	id: string;
	name: string;
	completedCycles?: JiraSlaCycle[];
	ongoingCycle?: JiraSlaCycle | null;
}

export interface JiraRequestSla {
	size?: number;
	start?: number;
	limit?: number;
	isLastPage?: boolean;
	values?: JiraRequestSlaMetric[];
}

export interface JiraServiceDeskData {
	desk: JiraServiceDeskRef;
	portal: JiraPortal | null;
	groups: JiraRequestTypeGroup[];
	requestTypes: {
		requestType: JiraRequestType;
		fields: JiraRequestTypeField[];
	}[];
	queues: JiraQueue[];
	metrics: JiraSlaMetric[];
	openAccess: boolean | null;
}

export interface JiraDataset {
	users: JiraUser[];
	issueTypes: JiraIssueType[];
	priorities: JiraPriority[];
	resolutions: JiraResolution[];
	statuses: JiraStatus[];
	linkTypes: JiraLinkType[];
	fields: JiraField[];
	workflows: JiraWorkflowData[];
	fieldOptions: JiraFieldOptions[];
	projects: JiraProjectData[];
	issues: JiraIssueData[];
	serviceDesks?: JiraServiceDeskData[];
	slaCalendars?: JiraWorkingCalendar[];
	automationRules?: JiraAutomationRule[];
}
