export function reroute(url: URL): string | undefined {
	if (url.pathname !== "/secure/RapidBoard.jspa") return undefined;
	if (url.searchParams.get("view") !== "planning") return undefined;
	const rapidViewId = Number(url.searchParams.get("rapidView"));
	if (!Number.isInteger(rapidViewId) || rapidViewId <= 0) return undefined;
	return `/boards/${rapidViewId}/plan`;
}
