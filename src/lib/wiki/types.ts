import type { UserRef } from "#lib/api-types.ts";

export type { UserRef };

export type SpaceSummary = {
	id: string;
	key: string;
	name: string;
	type: "global" | "personal";
	descriptionHtml: string | null;
	iconPath: string | null;
	homePage: { id: string; sourceId: string; title: string } | null;
	pageCount: number;
	created: string | null;
};

export type PageRef = {
	id: string;
	sourceId: string;
	title: string;
	hasChildren: boolean;
};

export type PageLabel = { id: string; label: string };

export type PageVersion = {
	number: number;
	title: string | null;
	created: string | null;
	message: string | null;
	minorEdit: boolean;
	author: UserRef | null;
	current: boolean;
};

export type Attachment = {
	id: string;
	fileName: string;
	mimeType: string | null;
	size: number;
	version: number;
	author: UserRef | null;
	created: string | null;
	comment: string | null;
	/** Set by the attachments page load: the signed-in user may delete this row. */
	canDelete?: boolean;
	versions?: {
		version: number;
		size: number;
		created: string | null;
		author: UserRef | null;
	}[];
};

export type PageComment = {
	id: string;
	parentId: string | null;
	author: UserRef | null;
	bodyHtml: string | null;
	created: string | null;
	updated: string | null;
	inline: boolean;
	inlineMarkerRef: string | null;
	inlineSelection: string | null;
	resolved: boolean;
	canEdit: boolean;
};

export type PageDetail = {
	id: string;
	sourceId: string;
	title: string;
	type: "page" | "blogpost";
	status: "current" | "draft" | "trashed";
	versionNumber: number;
	space: {
		id: string;
		key: string;
		name: string;
		type: "global" | "personal";
		iconPath: string | null;
	};
	ancestors: { id: string; sourceId: string; title: string }[];
	creator: UserRef | null;
	lastModifier: UserRef | null;
	created: string | null;
	updated: string | null;
	bodyHtml: string | null;
	labels: PageLabel[];
	attachments: Attachment[];
	comments: PageComment[];
	children: PageRef[];
	watchers: { count: number; watching: boolean };
	likes: { count: number; liked: boolean };
	restricted: boolean;
	spaceWatching: boolean;
};

export type VersionDetail = {
	number: number;
	title: string | null;
	created: string | null;
	message: string | null;
	minorEdit: boolean;
	author: UserRef | null;
	bodyHtml: string | null;
	current: boolean;
};

export type DiffResult = {
	from: number;
	to: number;
	blocks: { type: "equal" | "change"; html: string }[];
};

export type SearchHit = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	excerpt: string;
	updated: string | null;
	author: string | null;
	rank: number;
};

export type SearchResult = {
	total: number;
	offset: number;
	limit: number;
	hits: SearchHit[];
};

export type Suggestion = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
};

export type RecentPage = {
	id: string;
	sourceId: string;
	title: string;
	spaceKey: string;
	spaceName: string;
	updated: string | null;
	author: string | null;
};

export type HomeData = {
	recent: RecentPage[];
	spaces: SpaceSummary[];
	created: {
		id: string;
		sourceId: string;
		title: string;
		spaceKey: string;
		spaceName: string;
	}[];
	watched: {
		id: string;
		sourceId: string;
		title: string;
		spaceKey: string;
		spaceName: string;
	}[];
};

export type Restrictions = {
	space: {
		id: string;
		permission: string;
		user: UserRef | null;
		groupName: string | null;
		anonymous: boolean;
	}[];
	page: {
		id: string;
		operation: "read" | "update";
		user: UserRef | null;
		groupName: string | null;
	}[];
};

/** The page fields every wiki screen needs for the frame and its breadcrumbs. */
export type PageMeta = {
	id: string;
	sourceId: string;
	title: string;
	space: { key: string; name: string; iconPath: string | null };
	ancestors: { id: string; sourceId: string; title: string }[];
};
