export function reroute(url: URL): string | undefined {
	if (url.pathname !== "/secure/RapidBoard.jspa") return undefined;
	const view = url.searchParams.get("view");
	if (view !== "reporting" && view !== "releases") return undefined;
	const rapidView = url.searchParams.get("rapidView");
	if (rapidView === null) return undefined;
	const id = Number(rapidView);
	if (!Number.isFinite(id)) return undefined;
	return `/boards/${id}/${view === "reporting" ? "reports" : "releases"}`;
}
