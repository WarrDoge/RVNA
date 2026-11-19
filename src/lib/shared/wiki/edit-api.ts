// Request and response types of the wiki write API (src/lib/server/wiki-edit) as the editor
// screens (src/web/wiki/editor) use them. Dates are ISO strings. Errors are `{ error: string }`
// with the status codes listed per route; 409 and 423 bodies carry extra fields (see below).
import type { WikiDoc } from "./doc.ts";

export type WikiUserRef = {
	id: string;
	username: string;
	displayName: string;
	avatarUrl: string | null;
};

export type PageRef = {
	id: string;
	spaceKey: string;
	title: string;
	parentId: string | null;
	status: "current" | "draft" | "trashed";
	version: number;
};

export type LockInfo = {
	holder: WikiUserRef;
	acquiredAt: string;
	heartbeatAt: string;
	/** seconds until the lock expires without a heartbeat */
	expiresIn: number;
};

export type DraftInfo = {
	id: string;
	pageId: string | null;
	spaceKey: string;
	parentId: string | null;
	title: string;
	bodyDoc: WikiDoc | null;
	labels: string[];
	baseVersion: number | null;
	updatedAt: string;
};

export type RestrictionSubjects = { users: WikiUserRef[]; groups: string[] };
export type PageRestrictions = {
	read: RestrictionSubjects;
	update: RestrictionSubjects;
	/** view restrictions inherited from ancestors, nearest first; informational */
	inherited: {
		pageId: string;
		title: string;
		read: RestrictionSubjects;
		update: RestrictionSubjects;
	}[];
};
export type PageRestrictionsInput = {
	read: { userIds: string[]; groups: string[] };
	update: { userIds: string[]; groups: string[] };
};

// ---- GET /api/wiki/edit/pages/:id  (also .../edit/drafts/:draftId -> same shape, `draft` set)
export type EditorContext = {
	page: PageRef & {
		bodyDoc: WikiDoc;
		spaceName: string;
		updated: string | null;
		lastModifier: WikiUserRef | null;
	};
	/** ancestors from the space root to the parent */
	breadcrumb: { id: string; title: string }[];
	labels: string[];
	/** the caller's draft of this page, when one exists; the banner offers "Resume editing" */
	draft: DraftInfo | null;
	/** the lock as it stands; null when nobody edits. Not acquired by this GET. */
	lock: LockInfo | null;
	permissions: { canEdit: boolean; canRestrict: boolean; canDelete: boolean };
	attachments: {
		id: string;
		fileName: string;
		mimeType: string | null;
		size: number;
		url: string;
	}[];
};

// ---- POST /api/wiki/pages/drafts  {spaceKey, parentId?}  -> 201 {pageId, draftId}
//      Creates (or returns the caller's untouched) unpublished page, so uploads have a page.
export type CreateDraftInput = { spaceKey: string; parentId?: string | null };
export type CreateDraftResult = { pageId: string; draftId: string };

// ---- POST /api/wiki/pages -> 201 PageRef.  400 invalid doc, 403, 404 space, 409 title taken
export type CreatePageInput = {
	spaceKey: string;
	parentId?: string | null;
	title: string;
	bodyDoc: WikiDoc;
	labels?: string[];
	message?: string;
	/** publish this unpublished draft page (status draft) instead of inserting a new row */
	draftPageId?: string;
};

// ---- PUT /api/wiki/pages/:id -> 200 PageRef.
//      409 {error, currentVersion} when baseVersion is older than the stored version,
//      409 {error} when the new title is taken, 423 {error, lock: LockInfo} when another user holds a live lock.
export type UpdatePageInput = {
	title?: string;
	bodyDoc: WikiDoc;
	baseVersion?: number;
	message?: string;
	minorEdit?: boolean;
	labels?: string[];
	notifyWatchers?: boolean;
};

export type RestoreVersionInput = { version: number; message?: string };
export type RenamePageInput = { title: string };
// POST .../move: spaceKey omitted = same space; parentId null = space root; position = index among new siblings
export type MovePageInput = {
	spaceKey?: string;
	parentId?: string | null;
	position?: number;
};
export type CopyPageInput = {
	title: string;
	spaceKey?: string;
	parentId?: string | null;
	withChildren?: boolean;
	withAttachments?: boolean;
	withLabels?: boolean;
};
export type ReorderChildrenInput = { childIds: string[] };
export type SetLabelsInput = { labels: string[] };

// ---- locks.  POST /api/wiki/pages/:id/lock {takeOver?} -> 200 {acquired: true, lock}
//      or 409 {error, acquired: false, lock} (someone else edits; takeOver:true takes it over).
//      POST .../lock/heartbeat -> 200 {status: "ok", lock} | {status: "lost", lock} (taken over; keep the draft)
//      DELETE .../lock -> 204
export type LockResult = { acquired: boolean; lock: LockInfo | null };
export type HeartbeatResult = {
	status: "ok" | "lost" | "expired";
	lock: LockInfo | null;
};

// ---- drafts.  PUT /api/wiki/pages/:id/draft -> 200 {id, updatedAt}; DELETE /api/wiki/pages/:id/draft -> 204
//      (discarding the draft of a never-published page also deletes that page)
export type SaveDraftInput = {
	title: string;
	bodyDoc: WikiDoc;
	labels?: string[];
	baseVersion?: number;
};

// ---- GET /api/wiki/edit/pages/:id/restrictions -> PageRestrictions ; PUT /api/wiki/pages/:id/restrictions {PageRestrictionsInput}
//      403 unless the caller may restrict; 400 when the change would lock the caller out.

// ---- spaces.  POST /api/wiki/spaces (app admin) -> 201 SpaceSummary
export type SpaceSummary = {
	id: string;
	key: string;
	name: string;
	type: "global" | "personal";
	status: "current" | "archived";
	descriptionHtml: string | null;
	homePageId: string | null;
};
export type CreateSpaceInput = {
	key: string;
	name: string;
	description?: string;
};
export type UpdateSpaceInput = {
	name?: string;
	description?: string;
	homePageId?: string | null;
};
// POST /api/wiki/spaces/:key/archive | /unarchive (space admin) ; DELETE /api/wiki/spaces/:key (app admin)

export type SpacePermissionRow = {
	permission: string;
	user: WikiUserRef | null;
	groupName: string | null;
	anonymous: boolean;
};
// GET /api/wiki/edit/spaces/:key/permissions -> SpacePermissionRow[] ; PUT /api/wiki/spaces/:key/permissions {SpacePermissionRow-like input}
export type SpacePermissionsInput = {
	permissions: {
		permission: string;
		userId?: string;
		groupName?: string;
		anonymous?: boolean;
	}[];
};

// ---- templates.  GET /api/wiki/edit/spaces/:key/templates -> TemplateSummary[]
//      POST /api/wiki/spaces/:key/templates ; PUT/DELETE /api/wiki/templates/:id
export type TemplateSummary = {
	id: string;
	spaceKey: string | null;
	name: string;
	description: string | null;
};
export type TemplateDetail = TemplateSummary & { bodyDoc: WikiDoc };
export type TemplateInput = {
	name: string;
	description?: string;
	bodyDoc: WikiDoc;
};

// ---- editor support (read only)
// GET /api/wiki/edit/spaces -> {key, name, canCreate: boolean}[]   (spaces the caller can read)
// GET /api/wiki/edit/page-search?q=&spaceKey= -> {id, spaceKey, spaceName, title}[]   (max 20, title match)
// GET /api/wiki/edit/space-tree/:spaceKey -> {id, title, parentId, position}[]   (all current pages, for the move dialog)
// GET /api/wiki/edit/trash/:spaceKey -> {page: PageRef, trashedAt, trashedBy: WikiUserRef | null}[]
// GET /api/wiki/edit/groups?q= -> string[]
// POST /api/wiki/pages/:id/attachments (multipart, field "file", several allowed) -> UploadedAttachment[]
export type UploadedAttachment = {
	id: string;
	fileName: string;
	mimeType: string | null;
	size: number;
	url: string;
};

// ---- routes the sections above leave implicit (all write routes answer {error} with 400/403/404/409)
// POST   /api/wiki/pages/:id/restore-version {RestoreVersionInput} -> 200 PageRef  (restores the body, keeps the current title; 423 as for PUT)
// POST   /api/wiki/pages/:id/rename          {RenamePageInput}     -> 200 PageRef  (new version with the same body; 409 title taken)
// POST   /api/wiki/pages/:id/move            {MovePageInput}       -> 200 PageRef  (409 {error} names the clashing title; 400 under itself)
// POST   /api/wiki/pages/:id/copy            {CopyPageInput}       -> 201 PageRef  (children whose title is taken get " (copy)", " (copy 2)", ...)
// POST   /api/wiki/pages/:id/trash                                 -> 200 PageRef  (children move up to the parent; 409 for a space home page)
// POST   /api/wiki/pages/:id/restore                               -> 200 PageRef  (from the trash; 409 title taken)
// DELETE /api/wiki/pages/:id                                       -> 204          (purge: trashed pages only, space admin)
// POST   /api/wiki/pages/:id/children/order  {ReorderChildrenInput} -> 204         (400 unless childIds is exactly the current children)
// PUT    /api/wiki/pages/:id/labels          {SetLabelsInput}      -> 200 {labels: string[]}
// PUT    /api/wiki/pages/:id/restrictions    {PageRestrictionsInput} -> 200 PageRestrictions
// POST   /api/wiki/spaces/:key/archive | unarchive                 -> 200 SpaceSummary
// PUT    /api/wiki/spaces/:key               {UpdateSpaceInput}    -> 200 SpaceSummary
// PUT    /api/wiki/spaces/:key/permissions   {SpacePermissionsInput} -> 200 SpacePermissionRow[]  (400 when the caller would lose administer)
// POST   /api/wiki/spaces/:key/templates     {TemplateInput}       -> 201 TemplateDetail; PUT /api/wiki/templates/:id -> 200 TemplateDetail; DELETE -> 204
// GET    /api/wiki/edit/templates/:id                              -> TemplateDetail
export type TrashEntry = {
	page: PageRef;
	trashedAt: string;
	trashedBy: WikiUserRef | null;
};
export type EditorSpace = { key: string; name: string; canCreate: boolean };
export type PageSearchHit = {
	id: string;
	spaceKey: string;
	spaceName: string;
	title: string;
};
export type SpaceTreeNode = {
	id: string;
	title: string;
	parentId: string | null;
	position: number;
};
