import { api } from "#lib/api.ts";
import type {
	Attachment,
	PageComment,
	PageLabel,
	PageRef,
	Suggestion,
} from "./types.ts";

const enc = encodeURIComponent;

export function pageChildren(pageId: string) {
	return api<PageRef[]>(`/api/wiki/pages/${enc(pageId)}/children`);
}

export function suggestPages(query: string, signal?: AbortSignal) {
	return api<Suggestion[]>(`/api/wiki/search/suggest?query=${enc(query)}`, {
		signal,
	});
}

export function togglePageWatch(pageId: string, watching: boolean) {
	return api<{ count: number; watching: boolean }>(
		`/api/wiki/pages/${enc(pageId)}/watch`,
		{ method: "POST", body: JSON.stringify({ watching }) },
	);
}

export function toggleLike(pageId: string) {
	return api<{ count: number; liked: boolean }>(
		`/api/wiki/pages/${enc(pageId)}/like`,
		{ method: "POST" },
	);
}

export function addLabel(pageId: string, label: string) {
	return api<PageLabel>(`/api/wiki/pages/${enc(pageId)}/labels`, {
		method: "POST",
		body: JSON.stringify({ label }),
	});
}

export function removeLabel(labelId: string) {
	return api<void>(`/api/wiki/labels/${enc(labelId)}`, { method: "DELETE" });
}

export function createComment(
	pageId: string,
	body: {
		bodyHtml: string;
		parentId?: string | null;
		inline?: boolean;
		marker?: string | null;
		selection?: string | null;
	},
) {
	return api<PageComment>(`/api/wiki/pages/${enc(pageId)}/comments`, {
		method: "POST",
		body: JSON.stringify(body),
	});
}

export function updateComment(id: string, bodyHtml: string) {
	return api<PageComment>(`/api/wiki/comments/${enc(id)}`, {
		method: "PATCH",
		body: JSON.stringify({ bodyHtml }),
	});
}

export function deleteComment(id: string) {
	return api<void>(`/api/wiki/comments/${enc(id)}`, { method: "DELETE" });
}

export function resolveComment(id: string, resolved: boolean) {
	return api<PageComment>(`/api/wiki/comments/${enc(id)}/resolve`, {
		method: "POST",
		body: JSON.stringify({ resolved }),
	});
}

export function uploadAttachment(pageId: string, file: File) {
	const form = new FormData();
	form.append("file", file);
	return api<Attachment[]>(`/api/wiki/pages/${enc(pageId)}/attachments`, {
		method: "POST",
		body: form,
	});
}

export function deleteAttachment(id: string) {
	return api<void>(`/api/wiki/attachments/${enc(id)}`, { method: "DELETE" });
}

export function restoreVersion(pageId: string, version: number) {
	return api<PageRef>(`/api/wiki/pages/${enc(pageId)}/restore-version`, {
		method: "POST",
		body: JSON.stringify({ version }),
	});
}
