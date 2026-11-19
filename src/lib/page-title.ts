export type SiteInfo = {
	title: string;
	baseUrl: string;
	defaultIssueTypeId: string | null;
	defaultPriorityId: string | null;
};

const fallbackTitle = "RVNA";

/**
 * Every mounted page title, in mount order. The innermost page mounts first,
 * so the last title that is set wins over the shell's empty default.
 */
const mountedTitles = new Map<string, string | undefined>();
let siteTitle = fallbackTitle;

function applyTitle() {
	let pageTitle: string | undefined;
	for (const value of mountedTitles.values()) {
		if (value) pageTitle = value;
	}
	document.title = pageTitle ? `${pageTitle} - ${siteTitle}` : siteTitle;
}

/** Sets the site title used after the page title. */
export function setSiteTitle(title?: string) {
	siteTitle = title || fallbackTitle;
	applyTitle();
}

/** Registers a page title; the returned function removes it again. */
export function mountPageTitle(id: string, title?: string) {
	mountedTitles.set(id, title);
	applyTitle();
	return () => {
		mountedTitles.delete(id);
		applyTitle();
	};
}
