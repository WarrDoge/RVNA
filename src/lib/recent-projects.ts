export type RecentProject = {
	key: string;
	name: string;
	avatarUrl: string | null;
};

function storageKey(userId: string) {
	return `rvna.recentProjects:${userId}`;
}

export function recentProjects(userId: string): RecentProject[] {
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(storageKey(userId)) ?? "[]",
		) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is RecentProject =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as RecentProject).key === "string" &&
				typeof (item as RecentProject).name === "string",
		);
	} catch {
		return [];
	}
}

export function rememberProject(userId: string, project: RecentProject) {
	const next = [
		project,
		...recentProjects(userId).filter((item) => item.key !== project.key),
	].slice(0, 5);
	window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
	window.localStorage.setItem("rvna.lastProject", project.key);
}
