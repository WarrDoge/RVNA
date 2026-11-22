export interface GitlabProject {
	id: number;
	path_with_namespace: string;
	name: string | null;
	web_url: string;
	default_branch: string | null;
}

export interface GitlabBranch {
	name: string;
	commit: { id: string; committed_date?: string } | null;
	web_url?: string;
}

export interface GitlabCommit {
	id: string;
	title: string;
	message: string;
	author_name: string | null;
	author_email: string | null;
	committed_date: string | null;
	web_url: string | null;
}

export interface GitlabMergeRequest {
	iid: number;
	title: string;
	state: string;
	source_branch: string | null;
	target_branch: string | null;
	author: { name: string | null; email?: string | null } | null;
	reviewers?: { name: string | null; email?: string | null }[];
	web_url: string | null;
	updated_at: string | null;
}

export interface Page<T> {
	items: T[];
	nextPage: number | null;
}

export type FetchLike = (
	input: string,
	init?: { headers?: Record<string, string> },
) => Promise<{
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

function base(baseUrl: string) {
	return baseUrl.replace(/\/+$/, "");
}

const API_PATH = "/api/v4";

export class GitlabApi {
	readonly baseUrl: string;
	readonly token: string;
	readonly fetchImpl: FetchLike;

	constructor(baseUrl: string, token: string, fetchImpl: FetchLike = fetch) {
		this.baseUrl = base(baseUrl);
		this.token = token;
		this.fetchImpl = fetchImpl;
	}

	private async get(path: string) {
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			headers: { "PRIVATE-TOKEN": this.token },
		});
		if (!response.ok) {
			throw new Error(
				`GitLab returned ${response.status} for ${path}: ${await response.text()}`,
			);
		}
		const next = response.headers.get("x-next-page");
		return {
			body: (await response.json()) as unknown,
			nextPage: next && next !== "" ? Number(next) : null,
		};
	}

	private async paged<T>(path: string, page: number): Promise<Page<T>> {
		const separator = path.includes("?") ? "&" : "?";
		const result = await this.get(
			`${path}${separator}per_page=100&page=${page}`,
		);
		if (!Array.isArray(result.body)) {
			throw new Error(`GitLab returned a non-list response for ${path}`);
		}
		return {
			items: result.body as T[],
			nextPage: Number.isFinite(result.nextPage) ? result.nextPage : null,
		};
	}

	project(path: string) {
		return this.get(`${API_PATH}/projects/${encodeURIComponent(path)}`).then(
			(result) => result.body as GitlabProject,
		);
	}

	branches(projectId: number, page = 1) {
		return this.paged<GitlabBranch>(
			`${API_PATH}/projects/${projectId}/repository/branches`,
			page,
		);
	}

	commits(projectId: number, since: string, page = 1) {
		return this.paged<GitlabCommit>(
			`${API_PATH}/projects/${projectId}/repository/commits?since=${encodeURIComponent(since)}&all=true`,
			page,
		);
	}

	mergeRequests(projectId: number, since: string, page = 1) {
		return this.paged<GitlabMergeRequest>(
			`${API_PATH}/projects/${projectId}/merge_requests?state=all&order_by=updated_at&sort=desc&updated_after=${encodeURIComponent(since)}`,
			page,
		);
	}
}

export async function testConnection(
	baseUrl: string,
	token: string,
	fetchImpl: FetchLike = fetch,
) {
	const response = await fetchImpl(`${base(baseUrl)}${API_PATH}/version`, {
		headers: { "PRIVATE-TOKEN": token },
	});
	if (!response.ok) {
		throw new Error(`GitLab returned ${response.status} for /api/v4/version`);
	}
	const body = (await response.json()) as { version?: unknown };
	if (typeof body.version !== "string") {
		throw new Error("GitLab did not return a version");
	}
	return { version: body.version };
}
