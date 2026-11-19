import type {
	AttachmentLookup,
	DocRefs,
	HtmlContext,
	PageLookup,
} from "./convert-types.ts";
import { type DocNode, type RiRef, type WikiDoc, walkDoc } from "./doc.ts";

function isRef(value: unknown): value is RiRef {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as RiRef).tag === "string"
	);
}

export function pageLookupOf(
	ref: RiRef,
	defaultSpaceKey?: string,
): PageLookup | null {
	if (ref.tag !== "ri:page") return null;
	const title = ref.attrs["ri:content-title"];
	if (title === undefined) return null;
	return { title, spaceKey: ref.attrs["ri:space-key"] ?? defaultSpaceKey };
}

export function attachmentLookupOf(
	ref: RiRef,
	defaultSpaceKey?: string,
): AttachmentLookup | null {
	if (ref.tag !== "ri:attachment") return null;
	const fileName = ref.attrs["ri:filename"];
	if (fileName === undefined) return null;
	const page = ref.children?.find((child) => child.tag === "ri:page");
	return {
		fileName,
		title: page?.attrs["ri:content-title"],
		spaceKey:
			page?.attrs["ri:space-key"] ?? (page ? defaultSpaceKey : undefined),
	};
}

export function imageLookupOf(
	node: DocNode,
	defaultSpaceKey?: string,
): AttachmentLookup | null {
	const fileName = node.attrs?.fileName;
	if (typeof fileName !== "string" || fileName === "") return null;
	const page = node.attrs?.pageRef as
		| { title?: string; spaceKey?: string }
		| null
		| undefined;
	return {
		fileName,
		title: page?.title,
		spaceKey: page?.title ? (page.spaceKey ?? defaultSpaceKey) : undefined,
	};
}

export function collectDocRefs(
	doc: WikiDoc,
	defaultSpaceKey?: string,
): DocRefs {
	const pages = new Map<string, PageLookup>();
	const attachments = new Map<string, AttachmentLookup>();
	walkDoc(doc, (node) => {
		if (node.type === "image") {
			const lookup = imageLookupOf(node, defaultSpaceKey);
			if (lookup) attachments.set(JSON.stringify(lookup), lookup);
		}
		for (const mark of node.marks ?? []) {
			const ref = mark.attrs?.ref;
			if (mark.type !== "link" || !isRef(ref)) continue;
			const page = pageLookupOf(ref, defaultSpaceKey);
			if (page) pages.set(JSON.stringify(page), page);
			const attachment = attachmentLookupOf(ref, defaultSpaceKey);
			if (attachment) attachments.set(JSON.stringify(attachment), attachment);
		}
	});
	return { pages: [...pages.values()], attachments: [...attachments.values()] };
}

/** Returns a copy of the document with link hrefs and image sources filled from the lookups. */
export function resolveDocRefs(doc: WikiDoc, ctx: HtmlContext): WikiDoc {
	const copy = structuredClone(doc);
	walkDoc(copy, (node) => {
		if (node.type === "image") {
			const lookup = imageLookupOf(node, ctx.defaultSpaceKey);
			const src = lookup && ctx.attachmentHref?.(lookup);
			if (src) node.attrs = { ...node.attrs, src };
		}
		for (const mark of node.marks ?? []) {
			const ref = mark.attrs?.ref;
			if (mark.type !== "link" || !isRef(ref)) continue;
			const page = pageLookupOf(ref, ctx.defaultSpaceKey);
			const attachment = attachmentLookupOf(ref, ctx.defaultSpaceKey);
			const href =
				(page && ctx.pageHref?.(page)) ||
				(attachment && ctx.attachmentHref?.(attachment)) ||
				null;
			mark.attrs = { ...mark.attrs, href };
		}
	});
	return copy;
}
