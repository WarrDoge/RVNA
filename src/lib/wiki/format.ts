import {
	calendarDate,
	calendarDateTime,
	relativeShortDate,
} from "#lib/dates.ts";
import { decodeEntities } from "#lib/shared/wiki/xml.ts";

export function pageHref(page: { sourceId: string }) {
	return `/pages/viewpage.action?pageId=${encodeURIComponent(page.sourceId)}`;
}

export function spaceHref(key: string) {
	return `/display/${encodeURIComponent(key)}`;
}

export function pageTitleHref(spaceKey: string, title: string) {
	return `/display/${encodeURIComponent(spaceKey)}/${encodeURIComponent(title)}`;
}

/** Plain text of comment HTML, decoding the entities the editor stores. */
export function htmlToText(value: string | null) {
	if (!value) return "";
	return decodeEntities(value.replace(/<[^>]*>/g, "")).trim();
}

export function formatDate(value: string | null) {
	return calendarDate(value);
}

export function formatDateTime(value: string | null) {
	return calendarDateTime(value);
}

export function formatRelative(value: string | null) {
	return relativeShortDate(value);
}

export function formatSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isPreviewable(mimeType: string | null) {
	const base = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	return base.startsWith("image/") || base === "application/pdf";
}

export function attachmentUrl(
	pageSourceId: string,
	fileName: string,
	version: number,
	inline = false,
) {
	const base = `/download/attachments/${pageSourceId}/${encodeURIComponent(fileName)}?version=${version}`;
	return inline ? `${base}&inline=1` : base;
}

/** Plain text to comment HTML, one paragraph per line. */
export function textToHtml(value: string) {
	return value
		.split(/\n{2,}/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map(
			(paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`,
		)
		.join("");
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
