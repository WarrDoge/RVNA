import {
	type EditorContext,
	emptyDoc,
	type WikiDoc,
} from "#lib/shared/wiki/index.ts";
import { chooseResume, type LocalDraft, type ResumeOffer } from "./helpers.ts";

export type Mode = "create" | "edit" | "resume";

export type Content = {
	title: string;
	doc: WikiDoc;
	labels: string[];
	baseVersion: number | null;
};

/** What the editor opens with: the draft of an unpublished page, a resumed draft, or the published page. */
export function startingContent(
	ctx: EditorContext,
	mode: Mode,
	local: LocalDraft | null,
): {
	content: Content;
	offer: ResumeOffer | null;
	source: ResumeOffer["source"] | null;
} {
	const { page, draft } = ctx;
	if (page.status === "draft") {
		const saved = chooseResume(draft, local, null);
		return {
			content: {
				title: saved?.title ?? "",
				doc: saved?.bodyDoc ?? emptyDoc(),
				labels: saved?.labels ?? [],
				baseVersion: null,
			},
			offer: null,
			source: saved?.source ?? null,
		};
	}
	if (mode === "resume" && draft) {
		const saved = chooseResume(draft, local, page.updated);
		return {
			content: {
				title: saved?.title ?? draft.title,
				doc: saved?.bodyDoc ?? draft.bodyDoc ?? page.bodyDoc,
				labels: saved?.labels ?? draft.labels,
				baseVersion: saved?.baseVersion ?? draft.baseVersion ?? page.version,
			},
			offer: null,
			source: saved?.source ?? "server",
		};
	}
	return {
		content: {
			title: page.title,
			doc: page.bodyDoc,
			labels: ctx.labels,
			baseVersion: page.version,
		},
		offer: chooseResume(draft, local, page.updated),
		source: null,
	};
}
