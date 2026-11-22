import { isUnder } from "../project-keys.ts";

export const adminApiPrefix = "/api/admin";

const adminPagePaths = [
	"/secure/admin",
	"/secure/project",
	"/plugins/servlet/gitlab",
	"/plugins/servlet/messenger",
	"/plugins/servlet/project-config/:key/workflows",
	"/sk-admin",
];

function matchesAdminPage(path: string, pattern: string) {
	if (!pattern.includes(":")) return isUnder(path, pattern);
	const patternParts = pattern.split("/");
	const pathParts = path.split("/");
	if (pathParts.length < patternParts.length) return false;
	return patternParts.every((part, index) =>
		part.startsWith(":") ? pathParts[index] !== "" : part === pathParts[index],
	);
}

export function isAdminPagePath(path: string) {
	return adminPagePaths.some((pattern) => matchesAdminPage(path, pattern));
}
