const handled = new Set(["planning", "reporting", "releases"]);

/**
 * The board view of `/secure/RapidBoard.jspa`. The other three views are
 * rerouted by the backlog and reports tasks; an unknown view is the board view,
 * as before.
 */
export function reroute(url: URL): string | undefined {
	if (url.pathname !== "/secure/RapidBoard.jspa") return undefined;
	const view = url.searchParams.get("view");
	if (view && handled.has(view)) return undefined;

	const id = Number(url.searchParams.get("rapidView"));
	const rapidViewId = Number.isInteger(id) && id > 0 ? id : 0;
	return `/boards/${rapidViewId}/work`;
}
