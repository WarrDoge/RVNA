import { type RiRef, safeUrl } from "#lib/shared/wiki/index.ts";

/** The address to link to, or "" when it is empty or uses a scheme the wiki does not render. */
export function normalizeUrl(value: string): string {
	const trimmed = value.trim();
	if (trimmed === "") return "";
	if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^[/#]/.test(trimmed))
		return safeUrl(trimmed) ?? "";
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
