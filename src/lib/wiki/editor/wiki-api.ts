import { api } from "#lib/api.ts";
import type {
	CopyPageInput,
	CreatePageInput,
	PageRef,
	UpdatePageInput,
} from "#lib/shared/wiki/index.ts";

const enc = encodeURIComponent;

const json = (method: string, value: unknown): RequestInit => ({
	method,
	body: JSON.stringify(value),
});

export const publishNewPage = (input: CreatePageInput) =>
	api<PageRef>("/api/wiki/pages", json("POST", input));

export const publishPage = (pageId: string, input: UpdatePageInput) =>
	api<PageRef>(`/api/wiki/pages/${enc(pageId)}`, json("PUT", input));

export const copyPage = (pageId: string, input: CopyPageInput) =>
	api<PageRef>(`/api/wiki/pages/${enc(pageId)}/copy`, json("POST", input));

export const viewPageUrl = (pageId: string) =>
	`/pages/viewpage.action?pageId=${enc(pageId)}`;

export const spaceHomeUrl = (spaceKey: string) => `/display/${enc(spaceKey)}`;
