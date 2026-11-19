import type { RiRef } from "#lib/shared/wiki/index.ts";

export function normalizeUrl(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "") return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/#]/.test(trimmed))
		return trimmed;
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return `mailto:${trimmed}`;
	return `https://${trimmed}`;
}

export function pageLinkAttrs(page: {
	id: string;
	spaceKey: string;
	title: string;
}) {
	return {
		href: `/pages/viewpage.action?pageId=${page.id}`,
		ref: {
			tag: "ri:page",
			attrs: { "ri:content-title": page.title, "ri:space-key": page.spaceKey },
		} satisfies RiRef,
	};
}
