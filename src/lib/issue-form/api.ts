import { api } from "#lib/api.ts";
import type {
	CustomFieldSpec,
	ProjectDetail,
	ProjectSummary,
	UserWithEmail,
} from "#lib/api-types.ts";

export function fetchProjects() {
	return api<ProjectSummary[]>("/api/projects");
}

export function fetchProject(key: string) {
	const normalized = key.toUpperCase();
	return api<ProjectDetail>(`/api/projects/${encodeURIComponent(normalized)}`);
}

export function fetchProjectCustomFields(key: string, issueTypeId: string) {
	const normalized = key.toUpperCase();
	return api<CustomFieldSpec[]>(
		`/api/projects/${encodeURIComponent(normalized)}/custom-fields?issueType=${encodeURIComponent(issueTypeId)}`,
	);
}

export function fetchUsers(query: string, signal?: AbortSignal) {
	return api<UserWithEmail[]>(`/api/users?query=${encodeURIComponent(query)}`, {
		signal,
	});
}
