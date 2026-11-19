import { and, eq, inArray, sql } from "drizzle-orm";
import type { CurrentUser } from "../auth.ts";
import { db } from "../db.ts";
import type { SearchUser } from "../jql/compile.ts";
import { pageComments, pages, spaces } from "../schema.ts";
import { latestAttachments, visiblePages } from "./data.ts";
import { type MacroContext, type MacroSpace, renderMacro } from "./macros.ts";
import type { WikiAccess } from "./permissions.ts";
import {
	type AttachmentRef,
	convertStorageElements,
	decodeEntities,
	escapeHtml,
	findMacros,
	otherSpacePageKey,
	type StorageContext,
	sanitizeWikiBody,
	stripTags,
} from "./storage.ts";

export interface RenderablePage {
	id: string;
	sourceId: string;
	spaceId: string;
	title: string;
	bodyStorage: string | null;
	bodyHtml: string | null;
}

export interface RenderScope {
	user: CurrentUser;
	access: WikiAccess;
	space: MacroSpace;
	searchUser?: SearchUser | null;
}

interface Heading {
	level: number;
	id: string;
	text: string;
}

function slug(value: string): string {
	return value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function tocList(headings: Heading[], min: number, max: number) {
	const entries = headings.filter(
		(heading) => heading.level >= min && heading.level <= max,
	);
	if (entries.length === 0) return "";
	const items = entries
		.map(
			(heading) =>
				`<li class="wiki-toc-level-${heading.level}"><a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a></li>`,
		)
		.join("");
	return `<ul class="wiki-toc-list">${items}</ul>`;
}

/**
 * Adds anchors to headings and fills the table-of-contents placeholders. Runs
 * after sanitizing, on HTML that only contains allowed tags.
 */
export function finalizeHtml(source: string): string {
	const headings: Heading[] = [];
	const used = new Set<string>();

	let html = source.replace(
		/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g,
		(_match, levelText: string, attributes: string, inner: string) => {
			const level = Number(levelText);
			const text = stripTags(inner);
			const base = slug(text) || "section";
			let id = base;
			let suffix = 2;
			while (used.has(id)) id = `${base}-${suffix++}`;
			used.add(id);
			headings.push({ level, id, text });
			const existingId = attributes.match(/\bid="([^"]*)"/)?.[1];
			if (existingId) {
				used.add(existingId);
				return `<h${level}${attributes}>${inner}</h${level}>`;
			}
			return `<h${level}${attributes} id="${escapeHtml(id)}">${inner}</h${level}>`;
		},
	);

	html = html.replace(
		/<div class="wiki-toc" data-min-level="(\d)" data-max-level="(\d)"><div class="wiki-toc-title">Contents<\/div><\/div>/g,
		(_match, min: string, max: string) =>
			`<nav class="wiki-toc" aria-label="Table of contents"><div class="wiki-toc-title">Contents</div>${tocList(headings, Number(min), Number(max))}</nav>`,
	);

	html = html.replace(
		/<div class="toc-macro[^"]*"[^>]*><\/div>/g,
		`<nav class="wiki-toc" aria-label="Table of contents"><div class="wiki-toc-title">Contents</div>${tocList(headings, 1, 6)}</nav>`,
	);

	return html;
}

async function storageContext(
	page: RenderablePage,
	scope: RenderScope,
): Promise<StorageContext> {
	const attachments = await latestAttachments(page.id);
	const byName = new Map<string, AttachmentRef>(
		attachments.map((attachment) => [
			attachment.fileName,
			{
				id: attachment.id,
				fileName: attachment.fileName,
				version: attachment.version,
				mimeType: attachment.mimeType,
				size: attachment.size,
			},
		]),
	);

	const titled = await db
		.select({ title: pages.title, sourceId: pages.sourceId })
		.from(pages)
		.where(and(visiblePages(scope.access), eq(pages.spaceId, page.spaceId)));
	const pageSourceIdByTitle = new Map(
		titled.map((row) => [row.title, row.sourceId]),
	);

	const linkedSpaceKeys = [
		...new Set(
			[...(page.bodyStorage ?? "").matchAll(/\bri:space-key="([^"]*)"/g)].map(
				(match) => decodeEntities(match[1] as string).toLowerCase(),
			),
		),
	].filter((key) => key !== scope.space.key.toLowerCase());
	const linked =
		linkedSpaceKeys.length === 0
			? []
			: await db
					.select({
						key: spaces.key,
						title: pages.title,
						sourceId: pages.sourceId,
					})
					.from(pages)
					.innerJoin(spaces, eq(spaces.id, pages.spaceId))
					.where(
						and(
							visiblePages(scope.access),
							inArray(sql`lower(${spaces.key})`, linkedSpaceKeys),
						),
					);
	const otherSpacePages = new Map(
		linked.map((row) => [otherSpacePageKey(row.key, row.title), row.sourceId]),
	);

	const markers = await db
		.select({ reference: pageComments.inlineMarkerRef })
		.from(pageComments)
		.where(
			and(eq(pageComments.pageId, page.id), eq(pageComments.inline, true)),
		);
	const inlineMarkers = new Set(
		markers
			.map((row) => row.reference)
			.filter((reference): reference is string => reference !== null),
	);

	return {
		pageSourceId: page.sourceId,
		spaceKey: scope.space.key,
		attachments: byName,
		pageSourceIdByTitle,
		otherSpacePages,
		inlineMarkers,
	};
}

function isReadable(access: WikiAccess, page: { id: string; spaceId: string }) {
	return (
		access.readableSpaceIds.has(page.spaceId) &&
		!access.hiddenPageIds.has(page.id)
	);
}

/**
 * Renders a page body. Storage format is the source of truth so that macros can
 * be resolved server-side; the stored HTML is the fallback for pages that have
 * no storage body.
 */
export async function renderWikiBody(
	page: RenderablePage,
	scope: RenderScope,
): Promise<string | null> {
	if (!page.bodyStorage && !page.bodyHtml) return null;
	if (!isReadable(scope.access, page)) return null;

	if (!page.bodyStorage) {
		return finalizeHtml(sanitizeWikiBody(page.bodyHtml ?? ""));
	}

	const storage = await storageContext(page, scope);
	// A page author controls the body: one page read renders a bounded number of macros.
	let budget = 2000;

	const renderStorage = async (source: string, depth = 0): Promise<string> => {
		const context: MacroContext = {
			user: scope.user,
			access: scope.access,
			page: {
				id: page.id,
				sourceId: page.sourceId,
				spaceId: page.spaceId,
				title: page.title,
			},
			space: scope.space,
			storage,
			// Macros nested deeper than any real page are cut, so the recursion is bounded.
			renderBody: async (inner: string) =>
				depth < 30 ? renderStorage(inner, depth + 1) : "",
			searchUser: scope.searchUser ?? null,
		};

		// A renderer may return storage that holds macros again, hence the passes.
		let html = source;
		for (let pass = 0; pass < 10; pass++) {
			const macros = findMacros(html);
			if (macros.length === 0) break;
			let rendered = "";
			let cursor = 0;
			for (const macro of macros) {
				rendered += html.slice(cursor, macro.start);
				rendered +=
					budget-- > 0
						? await renderMacro(macro, context)
						: '<div class="wiki-unknown-macro">This page has too many macros to show them all.</div>';
				cursor = macro.end;
			}
			html = rendered + html.slice(cursor);
		}
		return html;
	};

	const expanded = await renderStorage(page.bodyStorage);
	const converted = convertStorageElements(expanded, storage);
	return finalizeHtml(sanitizeWikiBody(converted));
}
