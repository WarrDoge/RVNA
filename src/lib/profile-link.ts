export function profileHref(username: string) {
	return `/secure/ViewProfile.jspa?name=${encodeURIComponent(username)}`;
}
