const projectAlias = /^\/projects\/([^/]+)(?:\/summary)?\/?$/;

/**
 * `/projects/<key>` and `/projects/<key>/summary` showed the project issues page
 * there; `/projects/<key>/issues` is its canonical address.
 */
export function reroute(url: URL): string | undefined {
	const match = projectAlias.exec(url.pathname);
	if (!match) return undefined;
	return `/projects/${match[1]}/issues`;
}
