import type {
	EditorContext,
	EditorSpace,
	PageRestrictions,
	SpaceTreeNode,
	WikiUserRef,
} from "../../shared/wiki/index.ts";
import type { CurrentUser } from "../auth.ts";
import { loadWikiAccess, type WikiAccess } from "../wiki/permissions.ts";
import { listPageRestrictions } from "./restrictions.ts";
import {
	getDraftContext,
	getEditorContext,
	getSpaceTree,
	listEditorSpaces,
} from "./support.ts";

export type EditorPageData = {
	context: EditorContext;
	restrictions: PageRestrictions;
	spaces: EditorSpace[];
	tree: SpaceTreeNode[];
	me: WikiUserRef;
};

export function editorUserRef(actor: CurrentUser): WikiUserRef {
	return {
		id: actor.id,
		username: actor.username,
		displayName: actor.displayName,
		avatarUrl: actor.avatarUrl,
	};
}

async function finish(
	actor: CurrentUser,
	context: EditorContext,
	wiki: WikiAccess,
): Promise<EditorPageData> {
	const [restrictions, spaces, tree] = await Promise.all([
		listPageRestrictions(actor, context.page.id, wiki),
		listEditorSpaces(actor, wiki),
		getSpaceTree(actor, context.page.spaceKey, wiki),
	]);
	return { context, restrictions, spaces, tree, me: editorUserRef(actor) };
}

export async function editorPageData(actor: CurrentUser, pageId: string) {
	const wiki = await loadWikiAccess(actor);
	const context = await getEditorContext(actor, pageId, wiki);
	return finish(actor, context, wiki);
}

export async function draftEditorPageData(actor: CurrentUser, draftId: string) {
	const wiki = await loadWikiAccess(actor);
	const context = await getDraftContext(actor, draftId, wiki);
	return finish(actor, context, wiki);
}
