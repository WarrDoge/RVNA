import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { type CurrentUser, SESSION_COOKIE, sha256 } from "../auth.ts";
import { db } from "../db.ts";
import { getFilter } from "../filters/service.ts";
import { isHttpError } from "../http.ts";
import { requireBrowseIssue } from "../permissions.ts";
import { dashboards, filters, sessions } from "../schema.ts";

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

export type LegacyOutcome =
	| { kind: "login" }
	| { kind: "redirect"; location: string }
	| { kind: "none" }
	| { kind: "error"; status: number; message: string };

function redirect(location: string): LegacyOutcome {
	return { kind: "redirect", location };
}

export async function logout(
	actor: CurrentUser | null,
	sessionId: string | undefined,
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	if (sessionId) {
		await db.delete(sessions).where(eq(sessions.idHash, sha256(sessionId)));
	}
	return redirect("/login.jsp");
}

export async function quickSearch(
	actor: CurrentUser | null,
	input: { searchString?: string; searchStringEnc?: string },
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };

	const raw = input.searchStringEnc
		? safeDecode(input.searchStringEnc)
		: (input.searchString ?? "");
	const query = raw.trim();
	if (query === "") return redirect("/issues/");

	if (ISSUE_KEY.test(query)) {
		try {
			const issue = await requireBrowseIssue(actor, query);
			return redirect(`/browse/${issue.key}`);
		} catch (cause) {
			// A key the viewer cannot browse is just text; the search may still find it.
			if (!isHttpError(cause) || cause.status !== 404) throw cause;
		}
	}

	const jql = `text ~ "${query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
	return redirect(`/issues/?jql=${encodeURIComponent(jql)}`);
}

export async function projectIssueRedirect(
	actor: CurrentUser | null,
	issueKey: string,
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	if (!ISSUE_KEY.test(issueKey)) return { kind: "none" };
	return redirect(`/browse/${issueKey.toUpperCase()}`);
}

export async function attachmentRedirect(
	actor: CurrentUser | null,
	sourceId: string,
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	return redirect(`/api/attachments/${encodeURIComponent(sourceId)}`);
}

export async function attachmentZip(
	actor: CurrentUser | null,
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	return {
		kind: "error",
		status: 501,
		message:
			"Zip downloads are not available; download the attachments one by one",
	};
}

export async function issueFilter(
	actor: CurrentUser | null,
	input: { filter?: string; search: string },
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	const filter = input.filter;
	if (!filter || z.uuid().safeParse(filter).success) return { kind: "none" };

	const [row] = await db
		.select({ id: filters.id })
		.from(filters)
		.where(eq(filters.sourceId, filter))
		.limit(1);
	if (!row) return { kind: "none" };
	try {
		await getFilter(actor, row.id);
	} catch (cause) {
		if (isHttpError(cause) && cause.status === 404) return { kind: "none" };
		throw cause;
	}

	const query = new URLSearchParams(
		input.search.startsWith("?") ? input.search.slice(1) : input.search,
	);
	query.set("filter", row.id);
	return redirect(`/issues/?${query.toString()}`);
}

export async function dashboard(
	actor: CurrentUser | null,
	input: { pageId?: string },
): Promise<LegacyOutcome> {
	if (!actor) return { kind: "login" };
	const pageId = input.pageId;
	if (!pageId || z.uuid().safeParse(pageId).success) return { kind: "none" };

	const [row] = await db
		.select({ id: dashboards.id })
		.from(dashboards)
		.where(
			and(
				eq(dashboards.sourceId, pageId),
				actor.isAdmin
					? undefined
					: sql`(${dashboards.shared} or ${dashboards.ownerId} = ${actor.id}::uuid)`,
			),
		)
		.limit(1);
	if (!row) return { kind: "none" };
	return redirect(`/secure/Dashboard.jspa?selectPageId=${row.id}`);
}

function safeDecode(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export { SESSION_COOKIE };
