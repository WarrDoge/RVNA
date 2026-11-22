export interface PrivateApiOptions {
	privateApis?: boolean;
}

const reported = new Set<string>();

/** True when a private API part must be skipped; prints its notice once. */
export function skipPrivateApi(
	options: PrivateApiOptions | undefined,
	part: string,
): boolean {
	if (options?.privateApis) return false;
	if (!reported.has(part)) {
		reported.add(part);
		console.warn(
			`${part}: skipped because it uses an Atlassian API that is not public; pass --private-apis to import it`,
		);
	}
	return true;
}
