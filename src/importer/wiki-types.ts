export interface ConfluenceUserRef {
	type?: string;
	username?: string;
	userKey?: string;
	displayName?: string;
	email?: string;
	emailAddress?: string;
	active?: boolean;
	deleted?: boolean;
	profilePicture?: { path?: string; isDefault?: boolean };
}

export interface ConfluenceBody {
	storage?: { value?: string; representation?: string };
	view?: { value?: string; representation?: string };
	export_view?: { value?: string; representation?: string };
}

export interface ConfluenceSpace {
	id: number | string;
	key: string;
	name: string;
	type?: string;
	status?: string;
	description?: {
		plain?: { value?: string };
		view?: { value?: string };
	};
	homepage?: { id?: string };
	icon?: { path?: string };
	creator?: ConfluenceUserRef;
	creationDate?: string;
}

export interface ConfluenceVersion {
	number: number;
	by?: ConfluenceUserRef;
	when?: string;
	message?: string;
	minorEdit?: boolean;
}

export interface ConfluenceRestrictionSubjects {
	user?: { results?: ConfluenceUserRef[] };
	group?: { results?: { name?: string; type?: string }[] };
}

export interface ConfluenceContent {
	id: string;
	type: string;
	status: string;
	title?: string;
	space?: { key?: string };
	version?: ConfluenceVersion;
	history?: {
		createdDate?: string;
		createdBy?: ConfluenceUserRef;
		lastUpdated?: { when?: string; by?: ConfluenceUserRef };
	};
	ancestors?: { id: string }[];
	body?: ConfluenceBody;
	metadata?: {
		labels?: { results?: { name?: string; prefix?: string }[] };
		mediaType?: string;
	};
	extensions?: {
		position?: string;
		location?: string;
		fileSize?: number;
		mediaType?: string;
		inlineProperties?: {
			originalSelection?: string;
			markerRef?: string;
		};
		resolution?: { status?: string };
	};
	restrictions?: {
		read?: { restrictions?: ConfluenceRestrictionSubjects };
		update?: { restrictions?: ConfluenceRestrictionSubjects };
	};
	_links?: { download?: string; webui?: string };
}

export interface ConfluencePaged<T> {
	results: T[];
	start?: number;
	limit?: number;
	size?: number;
}

export interface ConfluenceSpacePermissions {
	operation?: { operationKey?: string; targetType?: string };
	subject?: {
		type?: string;
		userKey?: string;
		username?: string;
		name?: string;
	};
}

export interface WikiUser {
	userKey: string | null;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	active: boolean;
}

export interface WikiSocialUser {
	userKey: string | null;
	username: string | null;
	displayName: string | null;
	avatarUrl: string | null;
}

export interface WikiSpace {
	sourceId: string;
	key: string;
	name: string;
	type: "global" | "personal";
	status: "current" | "archived";
	descriptionHtml: string | null;
	homePageSourceId: string | null;
	creatorUserKey: string | null;
	created: Date | null;
	iconPath: string | null;
}

export interface WikiSpacePermission {
	permission: string;
	userKey: string | null;
	groupName: string | null;
	anonymous: boolean;
}

export interface WikiTemplate {
	sourceId: string;
	name: string;
	description: string | null;
	bodyStorage: string | null;
}

export interface WikiVersion {
	number: number;
	title: string;
	storage: string;
	view: string;
	authorUserKey: string | null;
	created: Date | null;
	message: string;
	minorEdit: boolean;
}

export interface WikiComment {
	sourceId: string;
	parentSourceId: string | null;
	authorUserKey: string | null;
	storage: string;
	view: string;
	created: Date | null;
	updated: Date | null;
	inline: boolean;
	inlineOriginalSelection: string | null;
	inlineMarkerRef: string | null;
	resolved: boolean;
}

export interface WikiAttachment {
	sourceId: string;
	attachmentId: string;
	fileName: string;
	mimeType: string | null;
	size: number;
	version: number;
	authorUserKey: string | null;
	created: Date | null;
	comment: string | null;
	storagePath: string;
	sha256: string;
}

export interface WikiRestriction {
	operation: "read" | "update";
	userKey: string | null;
	groupName: string | null;
}

export interface WikiPage {
	sourceId: string;
	spaceKey: string;
	parentSourceId: string | null;
	position: number;
	title: string;
	type: "page" | "blogpost";
	status: "current" | "draft" | "trashed";
	versionNumber: number;
	storage: string;
	view: string;
	creatorUserKey: string | null;
	created: Date | null;
	lastModifierUserKey: string | null;
	updated: Date | null;
	versions: WikiVersion[];
	comments: WikiComment[];
	attachments: WikiAttachment[];
	labels: string[];
	restrictions: WikiRestriction[];
	watchers: WikiSocialUser[];
	likes: WikiSocialUser[];
}

export interface WikiSpaceData {
	space: WikiSpace;
	permissions: WikiSpacePermission[];
	templates: WikiTemplate[];
	pages: WikiPage[];
	spaceWatchers: WikiSocialUser[];
}

export interface WikiDataset {
	users: WikiUser[];
	spaces: WikiSpaceData[];
}

export interface WikiMacroUsage {
	name: string;
	pages: Set<string>;
}
