export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}

/** Formats a minute count the way a Jira SLA column does: 2h 15m, 1m, -3h. */
export function formatSlaMinutes(minutes: number | null): string {
	if (minutes === null) return "—";
	const negative = minutes < 0;
	const total = Math.abs(minutes);
	const days = Math.floor(total / (60 * 24));
	const hours = Math.floor((total % (60 * 24)) / 60);
	const mins = total % 60;
	const parts: string[] = [];
	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (days === 0 && (mins > 0 || parts.length === 0)) parts.push(`${mins}m`);
	return `${negative ? "-" : ""}${parts.join(" ")}`;
}

export function formatGoal(minutes: number | null): string {
	if (minutes === null) return "no goal";
	return formatSlaMinutes(minutes);
}
