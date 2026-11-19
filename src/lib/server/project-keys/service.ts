import type { CurrentUser } from "../auth.ts";
import { customerRequestPath } from "../servicedesk/access.ts";

const issueKeyPattern = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

export type ProjectPageOutcome =
	| { kind: "redirect"; location: string }
	| { kind: "none" };

function redirect(location: string): ProjectPageOutcome {
	return { kind: "redirect", location };
}

function safeDecode(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * The old project page addresses: a previous key redirects to the current one,
 * `/browse/<KEY>` is the project summary and a customer request opens its portal.
 * Everything else is `none`: the page, or a 404, answers.
 */
export async function projectPage(
	actor: CurrentUser | null,
	input: { pathname: string; search: string; resolvedKey: string },
): Promise<ProjectPageOutcome> {
	const resolved = input.resolvedKey;
	const segments = input.pathname.split("/");
	const requested = safeDecode(segments[2] ?? "");
	const browse = segments[1] === "browse";

	if (browse && /^[A-Za-z][A-Za-z0-9_]*$/.test(resolved)) {
		return redirect(
			`/projects/${encodeURIComponent(resolved.toUpperCase())}/summary`,
		);
	}

	if (browse && issueKeyPattern.test(resolved)) {
		const portal = actor ? await customerRequestPath(actor, resolved) : null;
		if (portal) return redirect(portal);
	}

	if (requested !== "" && requested.toUpperCase() !== resolved) {
		segments[2] = encodeURIComponent(resolved);
		return redirect(`${segments.join("/")}${input.search}`);
	}

	return { kind: "none" };
}
