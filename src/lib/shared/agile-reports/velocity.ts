export type VelocitySprint = {
	id: string;
	name: string;
	startDate: string | null;
	endDate: string | null;
	completeDate: string | null;
	commitment: number;
	completed: number;
};

export type VelocityResult = {
	sprints: VelocitySprint[];
	averageCompleted: number;
	averageCommitment: number;
};

export function buildVelocity(
	sprints: VelocitySprint[],
	limit = 7,
): VelocityResult {
	const closed = sprints
		.filter((sprint) => sprint.completeDate || sprint.endDate)
		.sort((left, right) =>
			(left.completeDate ?? left.endDate ?? "").localeCompare(
				right.completeDate ?? right.endDate ?? "",
			),
		)
		.slice(-limit);
	const average = (values: number[]) =>
		values.length === 0
			? 0
			: values.reduce((sum, value) => sum + value, 0) / values.length;
	return {
		sprints: closed,
		averageCompleted: average(closed.map((sprint) => sprint.completed)),
		averageCommitment: average(closed.map((sprint) => sprint.commitment)),
	};
}
