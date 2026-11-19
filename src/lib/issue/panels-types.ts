/** The API shapes of the issue-view panels, shared by the loader and the components. */

export type SlaState = "ongoing" | "paused" | "completed" | "breached";

export type SlaCycle = {
	cycle: number;
	state: SlaState;
	startedAt: string;
	stoppedAt: string | null;
	goalMinutes: number | null;
	elapsedMinutes: number;
	remainingMinutes: number | null;
	breached: boolean;
	breachTime: string | null;
};

export type SlaMetric = {
	id: string;
	name: string;
	customerVisible: boolean;
	goalMinutes: number | null;
	calendar: { name: string; timezone: string } | null;
	cycles: SlaCycle[];
};

export type ServiceDeskRequest = {
	requestType: { id: string; name: string } | null;
	channel: string | null;
	portalId: string | null;
	customerUrl: string | null;
	isAgent: boolean;
};
