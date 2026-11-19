const pending = new Map<number, Set<Promise<unknown>>>();

const MOVE_WAIT_MS = 5_000;

/**
 * Track an in-flight board move so a board read that starts while the move is
 * still committing waits for it. Without this a page reload issued right after
 * a drop can render the pre-move board.
 */
export function trackBoardMove<T>(
	rapidViewId: number,
	operation: Promise<T>,
): Promise<T> {
	const operations = pending.get(rapidViewId) ?? new Set();
	operations.add(operation);
	pending.set(rapidViewId, operations);

	const done = () => {
		operations.delete(operation);
		if (operations.size === 0 && pending.get(rapidViewId) === operations) {
			pending.delete(rapidViewId);
		}
	};
	operation.then(done, done);
	return operation;
}

export async function waitForBoardMoves(rapidViewId: number) {
	const operations = pending.get(rapidViewId);
	if (!operations || operations.size === 0) return;
	const settled = Promise.allSettled([...operations]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			settled,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, MOVE_WAIT_MS);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
