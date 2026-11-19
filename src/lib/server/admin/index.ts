export const adminApiPrefix = "/api/admin";

const adminPagePrefixes = [
	"/secure/admin",
	"/secure/project/",
	"/plugins/servlet/gitlab",
	"/plugins/servlet/messenger",
];

export function isAdminPagePath(path: string) {
	return adminPagePrefixes.some(
		(prefix) =>
			path === prefix ||
			path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
	);
}
