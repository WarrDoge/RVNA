export type RecentBoard = {
	rapidViewId: number;
	name: string;
	type: "scrum" | "kanban";
	projectKey: string | null;
};

function storageKey(userId: string) {
	return `rvna.recentBoards:${userId}`;
}

export function recentBoards(userId: string): RecentBoard[] {
	try {
		const parsed = JSON.parse(
			window.localStorage.getItem(storageKey(userId)) ?? "[]",
		) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is RecentBoard =>
				typeof item === "object" &&
				item !== null &&
				typeof (item as RecentBoard).rapidViewId === "number" &&
				typeof (item as RecentBoard).name === "string",
		);
	} catch {
		return [];
	}
}

export function rememberBoard(userId: string, board: RecentBoard) {
	const next = [
		board,
		...recentBoards(userId).filter(
			(item) => item.rapidViewId !== board.rapidViewId,
		),
	].slice(0, 6);
	window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
}
