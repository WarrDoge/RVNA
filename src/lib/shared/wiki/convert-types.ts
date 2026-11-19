import type { WikiDoc } from "./doc.ts";

/** Element, macro and parameter names `storageToDoc` met but does not know; filled by the converter. */
export type ConvertReport = { unknown: Map<string, number> };

export type PageLookup = { title: string; spaceKey?: string };
export type AttachmentLookup = {
	fileName: string;
	title?: string;
	spaceKey?: string;
};

/** Lookups that turn references into urls; return null when the target does not exist. */
export type HtmlContext = {
	pageHref?: (ref: PageLookup) => string | null;
	attachmentHref?: (ref: AttachmentLookup) => string | null;
	/** space a page reference without ri:space-key points to */
	defaultSpaceKey?: string;
};

export type DocRefs = { pages: PageLookup[]; attachments: AttachmentLookup[] };

export type ResolveDoc = (doc: WikiDoc) => WikiDoc;
