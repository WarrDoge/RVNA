/** Minutes from local midnight, end exclusive. 1440 is midnight at the end of the day. */
export interface WorkingInterval {
	start: number;
	end: number;
}

export interface SlaCalendar {
	/** IANA timezone name, e.g. Europe/Helsinki. */
	timezone: string;
	/** Seven entries, Monday first. */
	workingHours: WorkingInterval[][];
	/** Local dates (YYYY-MM-DD) that are not working days. */
	holidays: string[];
}

export type SlaCondition =
	| { type: "issue_created" }
	| { type: "entered_status"; statusId: string }
	| { type: "comment_by_customer" }
	| { type: "comment_for_customer" }
	| { type: "assignee_set" }
	| { type: "assignee_cleared" }
	| { type: "resolution_set" }
	| { type: "resolution_cleared" };

export type SlaEvent =
	| { kind: "created"; at: Date }
	| { kind: "status"; at: Date; statusId: string }
	| {
			kind: "comment";
			at: Date;
			author: "customer" | "agent";
			internal: boolean;
	  }
	| { kind: "assignee"; at: Date; assigneeId: string | null }
	| { kind: "resolution"; at: Date; resolutionId: string | null };

export interface SlaMetricConditions {
	/** Any of these starts a cycle. Empty means the metric never starts. */
	start: SlaCondition[];
	/** While any of these holds the cycle is paused. */
	pause: SlaCondition[];
	/** Any of these stops the running cycle. */
	stop: SlaCondition[];
}

export interface SlaGoal {
	/** Working minutes allowed; null means no target. */
	minutes: number | null;
	calendar: SlaCalendar;
}

export interface SlaCycleInput {
	metric: SlaMetricConditions;
	goal: SlaGoal;
	events: SlaEvent[];
	now: Date;
}

export interface SlaPause {
	from: Date;
	to: Date;
}

export interface SlaCycle {
	/** 1 for the first cycle, 2 after a reopen. */
	cycle: number;
	startedAt: Date;
	stoppedAt: Date | null;
	pausedIntervals: SlaPause[];
	/** Set while the cycle is paused, independent of the last interval's end. */
	pausedAt: Date | null;
	goalMinutes: number | null;
	elapsedMinutes: number;
	remainingMinutes: number | null;
	/** When working time first reached the goal, null when it never did. */
	breachTime: Date | null;
	breached: boolean;
}
