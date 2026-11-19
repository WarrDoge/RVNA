import type { Reroute } from "@sveltejs/kit/hooks";
import { reroute as adminIssueconf } from "./reroute/admin-issueconf.ts";
import { reroute as boardBacklog } from "./reroute/board-backlog.ts";
import { reroute as boardWork } from "./reroute/board-work.ts";
import { reroute as navigator } from "./reroute/navigator.ts";
import { reroute as projects } from "./reroute/projects.ts";
import { reroute as reports } from "./reroute/reports.ts";
import { reroute as wikiRead } from "./reroute/wiki-read.ts";

// Order matters where two areas share an address: the more specific area first.
const areas = [
	navigator,
	reports,
	boardBacklog,
	boardWork,
	projects,
	wikiRead,
	adminIssueconf,
];

export const reroute: Reroute = ({ url }) => {
	if (url.pathname === "/login") return "/login.jsp";
	for (const area of areas) {
		const target = area(url);
		if (target) return target;
	}
};
