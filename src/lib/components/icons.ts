/** SVG bodies of the icons. */
export type IconDefinition = {
	size: number;
	viewBox: string;
	fill?: string;
	body: string;
};

export const iconNames = [
	"app-switcher",
	"chevron-down",
	"search",
	"bell",
	"help",
	"settings",
	"copy",
	"chevron-right",
	"issues",
	"link",
	"attachment",
	"eye",
	"clock",
	"comment",
	"history",
	"trash",
	"plus",
	"close",
	"check",
	"cross",
	"bold",
	"italic",
	"underline",
	"strikethrough",
	"bullet-list",
	"numbered-list",
	"task-list",
	"image",
	"table",
	"inline-code",
	"code-block",
	"quote",
	"star",
	"star-filled",
	"export",
	"share",
	"columns",
	"list-view",
	"detail-view",
	"sidebar",
	"kebab",
	"tag",
	"keyboard",
	"edit",
	"assign",
	"chevron-left",
	"branch",
	"commit",
	"merge-request",
	"pipeline-success",
	"pipeline-failed",
	"pipeline-running",
	"pipeline-pending",
	"pipeline-canceled",
	"pipeline-skipped",
	"pipeline-manual",
	"chevron-up",
	"refresh",
	"issue-type-epic",
	"issue-type-subtask",
	"issue-type-bug",
	"issue-type-story",
	"issue-type-change",
	"issue-type-task",
	"issue-type-default",
	"priority-highest",
	"priority-high",
	"priority-medium",
	"priority-low",
	"priority-lowest",
	"priority-none",
] as const;

export type IconName = (typeof iconNames)[number];

export const iconDefinitions: Record<IconName, IconDefinition> = {
	"app-switcher": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "currentColor",
		body: '<circle cx="2" cy="2" r="1.5"></circle><circle cx="8" cy="2" r="1.5"></circle><circle cx="14" cy="2" r="1.5"></circle><circle cx="2" cy="8" r="1.5"></circle><circle cx="8" cy="8" r="1.5"></circle><circle cx="14" cy="8" r="1.5"></circle><circle cx="2" cy="14" r="1.5"></circle><circle cx="8" cy="14" r="1.5"></circle><circle cx="14" cy="14" r="1.5"></circle>',
	},
	"chevron-down": {
		size: 12,
		viewBox: "0 0 12 12",
		fill: "none",
		body: '<path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	search: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"></circle><path d="m15.5 15.5 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
	},
	bell: {
		size: 24,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M12 3a6 6 0 0 0-6 6v4l-1.6 3.2h15.2L18 13V9a6 6 0 0 0-6-6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	help: {
		size: 24,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"></circle><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.4v.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><circle cx="12" cy="16.6" r="1" fill="currentColor"></circle>',
	},
	settings: {
		size: 24,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.6"></circle><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"></circle><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(0 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(45 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(90 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(135 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(180 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(225 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(270 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line><line x1="12" y1="1.8" x2="12" y2="5" transform="rotate(315 12 12)" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></line>',
	},
	copy: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<rect x="8.5" y="8.5" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"></rect><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	"chevron-right": {
		size: 12,
		viewBox: "0 0 12 12",
		fill: "none",
		body: '<path d="m4.5 2.5 3.5 3.5-3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	issues: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><circle cx="19" cy="18" r="2" fill="currentColor"></circle>',
	},
	link: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7L11 7.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path><path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 1 0 5.7 5.7l1.3-1.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
	},
	attachment: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M20 11.5 12.6 19a5 5 0 0 1-7-7l7.7-7.7a3.4 3.4 0 0 1 4.8 4.8l-7.7 7.7a1.8 1.8 0 0 1-2.5-2.5l7-7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	eye: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path><circle cx="12" cy="12" r="2.8" fill="currentColor"></circle>',
	},
	clock: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.7"></circle><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	comment: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M4 5.5h16v11H10l-4.5 3v-3H4v-11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path>',
	},
	history: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M4 5v4h4M4.6 9A8 8 0 1 1 4 12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>',
	},
	trash: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	plus: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
	},
	close: {
		size: 16,
		viewBox: "0 0 24 24",
		fill: "none",
		body: '<path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>',
	},
	check: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="m3 8.5 3.2 3.2L13 4.9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	cross: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
	},
	bold: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M4.5 3h4.2a2.6 2.6 0 0 1 0 5.2H4.5V3Zm0 5.2h4.8a2.9 2.9 0 0 1 0 5.8H4.5V8.2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>',
	},
	italic: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M7 3h5M4 13h5M9.5 3 6.5 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>',
	},
	underline: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 13.5h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>',
	},
	strikethrough: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M3 8h10M10.8 5.2C10.4 4 9.3 3.2 8 3.2c-1.6 0-2.7.9-2.7 2.2 0 1 .7 1.7 2.2 2.1M5.2 10.8c.4 1.2 1.5 2 2.8 2 1.6 0 2.7-.9 2.7-2.2 0-.5-.2-.9-.5-1.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>',
	},
	"bullet-list": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="3.5" cy="4" r="1.2" fill="currentColor"></circle><circle cx="3.5" cy="8" r="1.2" fill="currentColor"></circle><circle cx="3.5" cy="12" r="1.2" fill="currentColor"></circle><path d="M6.5 4h7M6.5 8h7M6.5 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>',
	},
	"numbered-list": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M6.5 4h7M6.5 8h7M6.5 12h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M2 2.8h1v2.4M2 12.6c0-.5.4-.8.9-.8s.9.3.9.8c0 .9-1.8 1-1.8 2.2h1.8M2.2 7h1.3l-1.3 1.6h1.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	"task-list": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2.2" y="2.2" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3"></rect><rect x="2.2" y="9.8" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.3"></rect><path d="M8.5 4.2h5M8.5 11.8h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="m3.3 4.2.8.8 1.2-1.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	image: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"></rect><circle cx="5.6" cy="6.4" r="1.1" fill="currentColor"></circle><path d="m3 12 3.4-3.4 2.3 2.3 1.6-1.6L13 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	table: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"></rect><path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" stroke="currentColor" stroke-width="1.2"></path>',
	},
	"inline-code": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="m6 4.5-3.5 3.5L6 11.5M10 4.5 13.5 8 10 11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	"code-block": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"></rect><path d="m6.6 6.2-1.8 1.8 1.8 1.8M9.4 6.2 11.2 8l-1.8 1.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	quote: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M3 4v8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path><path d="M6 5h7M6 8h7M6 11h4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>',
	},
	star: {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6L8 2.2Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path>',
	},
	"star-filled": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6L8 2.2Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"></path>',
	},
	export: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M8 2v8M5 7l3 3 3-3M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	share: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="11.5" cy="3.5" r="1.9" stroke="currentColor" stroke-width="1.3"></circle><circle cx="4.5" cy="8" r="1.9" stroke="currentColor" stroke-width="1.3"></circle><circle cx="11.5" cy="12.5" r="1.9" stroke="currentColor" stroke-width="1.3"></circle><path d="m6.3 7.1 3.4-2.4M6.3 8.9l3.4 2.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path>',
	},
	columns: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.4"></rect><path d="M6 3v10M10 3v10" stroke="currentColor" stroke-width="1.2"></path>',
	},
	"list-view": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>',
	},
	"detail-view": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"></rect><rect x="9" y="3" width="5" height="10" rx="1" stroke="currentColor" stroke-width="1.3"></rect>',
	},
	sidebar: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"></rect><path d="M6 3v10" stroke="currentColor" stroke-width="1.3"></path>',
	},
	kebab: {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<circle cx="8" cy="3.4" r="1.3" fill="currentColor"></circle><circle cx="8" cy="8" r="1.3" fill="currentColor"></circle><circle cx="8" cy="12.6" r="1.3" fill="currentColor"></circle>',
	},
	tag: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M2.5 7.4V3a.5.5 0 0 1 .5-.5h4.4a1 1 0 0 1 .7.3l5 5a1 1 0 0 1 0 1.4l-4.4 4.4a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1-.3-.7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path><circle cx="5.4" cy="5.4" r="0.9" fill="currentColor"></circle>',
	},
	keyboard: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<rect x="1.5" y="4" width="13" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"></rect><path d="M4 6.5h.01M6.2 6.5h.01M8.4 6.5h.01M10.6 6.5h.01M12.4 6.5h.01M4.6 9.4h6.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path>',
	},
	edit: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="m10.6 2.9 2.5 2.5-7 7-3.1.6.6-3.1 7-7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"></path>',
	},
	assign: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="6" cy="5" r="2.6" stroke="currentColor" stroke-width="1.3"></circle><path d="M1.8 13.4c0-2.3 1.9-3.9 4.2-3.9s4.2 1.6 4.2 3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path><path d="M12 5v4M10 7h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path>',
	},
	"chevron-left": {
		size: 12,
		viewBox: "0 0 12 12",
		fill: "none",
		body: '<path d="M7.5 2.5 4 6l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	branch: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="4.5" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.2"></circle><circle cx="4.5" cy="12.5" r="1.8" stroke="currentColor" stroke-width="1.2"></circle><circle cx="11.5" cy="6" r="1.8" stroke="currentColor" stroke-width="1.2"></circle><path d="M4.5 5.3v5.4M11.5 7.8c0 2.2-2 3-4.4 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path>',
	},
	commit: {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="8" cy="8" r="2.6" stroke="currentColor" stroke-width="1.2"></circle><path d="M1 8h4.4M10.6 8H15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path>',
	},
	"merge-request": {
		size: 16,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<circle cx="3.5" cy="3.5" r="1.7" stroke="currentColor" stroke-width="1.2"></circle><circle cx="3.5" cy="12.5" r="1.7" stroke="currentColor" stroke-width="1.2"></circle><circle cx="12.5" cy="8" r="1.7" stroke="currentColor" stroke-width="1.2"></circle><path d="M3.5 5.2v5.6M10.9 8H8.2a2.4 2.4 0 0 1-2.4-2.4v-.9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"></path>',
	},
	"pipeline-success": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: success</title><circle cx="8" cy="8" r="7" fill="#2abb7f"></circle><path d="m4.6 8.2 2.2 2.2 4.6-4.6" stroke="#0d1017" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>',
	},
	"pipeline-failed": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: failed</title><circle cx="8" cy="8" r="7" fill="#e5493a"></circle><path d="m5.4 5.4 5.2 5.2M10.6 5.4l-5.2 5.2" stroke="#0d1017" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	"pipeline-running": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: running</title><circle cx="8" cy="8" r="7" fill="#388bff"></circle><path d="M8 4.4V8l2.4 1.5" stroke="#0d1017" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>',
	},
	"pipeline-pending": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: pending</title><circle cx="8" cy="8" r="7" fill="#388bff"></circle><path d="M8 4.4V8l2.4 1.5" stroke="#0d1017" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"></path>',
	},
	"pipeline-canceled": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: canceled</title><circle cx="8" cy="8" r="7" fill="#758195"></circle><path d="M5 8h6" stroke="#0d1017" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	"pipeline-skipped": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: skipped</title><circle cx="8" cy="8" r="7" fill="#758195"></circle><path d="M5 8h6" stroke="#0d1017" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	"pipeline-manual": {
		size: 14,
		viewBox: "0 0 16 16",
		body: '<title>Pipeline: manual</title><circle cx="8" cy="8" r="7" fill="#758195"></circle><path d="M5 8h6" stroke="#0d1017" stroke-width="1.6" stroke-linecap="round"></path>',
	},
	"chevron-up": {
		size: 12,
		viewBox: "0 0 12 12",
		fill: "none",
		body: '<path d="M2.5 7.5 6 4l3.5 3.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	refresh: {
		size: 14,
		viewBox: "0 0 16 16",
		fill: "none",
		body: '<path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5V5h-2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	"issue-type-epic": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#904EE2"></rect><path d="M9.4 2.6 4.8 9h2.9l-1.1 4.4L11.2 7H8.3l1.1-4.4Z" fill="#fff"></path>',
	},
	"issue-type-subtask": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#4BADE8"></rect><path d="M4.5 8h7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"></path>',
	},
	"issue-type-bug": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<circle cx="8" cy="8" r="6" fill="#E5493A"></circle><circle cx="8" cy="8" r="2.2" fill="#fff"></circle>',
	},
	"issue-type-story": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#63BA3C"></rect><path d="M5 3.5h6v9.5l-3-2-3 2V3.5Z" fill="#fff"></path>',
	},
	"issue-type-change": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#00A3BF"></rect><path d="M8 3.2 12.8 8 8 12.8 3.2 8 8 3.2Z" fill="none" stroke="#fff" stroke-width="1.5"></path>',
	},
	"issue-type-task": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#4BADE8"></rect><path d="m4.4 8.2 2.3 2.3 4.9-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>',
	},
	"issue-type-default": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect width="16" height="16" rx="3" fill="#758195"></rect><circle cx="8" cy="8" r="2.2" fill="#fff"></circle>',
	},
	"priority-highest": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 2.5 5 4.5H3l5-4.5Zm0 5 5 4.5H3L8 7.5Z" fill="#DE350B"></path>',
	},
	"priority-high": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 3 5.5 5.5H2.5L8 3Z" fill="#DE350B"></path>',
	},
	"priority-medium": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect x="3" y="5" width="10" height="2.2" rx="1" fill="#FF991F"></rect><rect x="3" y="8.8" width="10" height="2.2" rx="1" fill="#FF991F"></rect>',
	},
	"priority-low": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 13 5.5-5.5H2.5L8 13Z" fill="#2684FF"></path>',
	},
	"priority-lowest": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<path d="m8 13.5 5-4.5H3l5 4.5Zm0-5 5-4.5H3L8 8.5Z" fill="#2684FF"></path>',
	},
	"priority-none": {
		size: 16,
		viewBox: "0 0 16 16",
		body: '<rect x="3" y="7" width="10" height="2" rx="1" fill="#758195"></rect>',
	},
};

/** The built-in icons an administrator can choose, in picker order. */
export const issueTypeIconKeys = [
	{ key: "epic", label: "Epic" },
	{ key: "subtask", label: "Sub-task" },
	{ key: "bug", label: "Bug" },
	{ key: "story", label: "Story" },
	{ key: "change", label: "Change" },
	{ key: "task", label: "Task" },
	{ key: "default", label: "Default" },
] as const;

export type IssueTypeIconKey = (typeof issueTypeIconKeys)[number]["key"];

const iconKeySet = new Set<string>(issueTypeIconKeys.map((entry) => entry.key));

export function issueTypeIconKeyForName(name: string): IssueTypeIconKey {
	const normalized = name.toLowerCase();
	if (normalized.includes("epic")) return "epic";
	if (normalized.includes("sub-task") || normalized.includes("subtask")) {
		return "subtask";
	}
	if (normalized.includes("bug")) return "bug";
	if (
		normalized.includes("story") ||
		normalized.includes("feature") ||
		normalized.includes("improvement")
	) {
		return "story";
	}
	if (
		normalized.includes("change") ||
		normalized.includes("incident") ||
		normalized.includes("problem") ||
		normalized.includes("service") ||
		normalized.includes("request") ||
		normalized.includes("it service")
	) {
		return "change";
	}
	if (normalized.includes("task")) return "task";
	return "default";
}

/** `builtin:<key>` wins; an imported Jira icon URL falls back to name matching. */
export function issueTypeIconKey(
	icon: string | null | undefined,
	name: string,
): IssueTypeIconKey {
	if (icon?.startsWith("builtin:")) {
		const key = icon.slice("builtin:".length);
		if (iconKeySet.has(key)) return key as IssueTypeIconKey;
	}
	return issueTypeIconKeyForName(name);
}

export function isAdminChosenIcon(icon: string | null | undefined) {
	return (
		icon?.startsWith("builtin:") === true &&
		iconKeySet.has(icon.slice("builtin:".length))
	);
}

export function priorityIconName(name: string): IconName {
	const normalized = name.toLowerCase();
	if (["highest", "high", "medium", "low", "lowest"].includes(normalized)) {
		return `priority-${normalized}` as IconName;
	}
	if (["blocker", "critical"].includes(normalized)) return "priority-highest";
	if (normalized === "major") return "priority-high";
	if (normalized === "minor") return "priority-low";
	if (normalized === "trivial") return "priority-lowest";
	return "priority-none";
}
