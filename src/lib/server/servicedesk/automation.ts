import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db.ts";
import { automationRules, issues, serviceDesks } from "../schema.ts";

export interface AutomationOutcome {
	applied: string[];
	skipped: string[];
}

interface EditOperation {
	type?: string;
	fieldId?: string;
	fieldType?: string;
	value?: {
		type?: string;
		value?: unknown;
		additional?: unknown;
	};
}

interface SprintDescriptor {
	id: number;
	name: string;
	state: string;
	activatedAt: number;
	raw: string;
}

const SPRINT_ID = /(?:^|\[|,)\s*id=(-?\d+)/;
const SPRINT_NAME =
	/(?:^|\[|,)\s*name=(.*?)(?=,(?:id|name|state|activatedDate|completeDate|endDate|startDate|rapidViewId|sequence|goal|autoStartStop|incompleteIssuesDestinationId|synced)=|]$)/;
const SPRINT_STATE = /(?:^|\[|,)\s*state=([A-Za-z]+)/;
const SPRINT_ACTIVATED = /(?:^|\[|,)\s*activatedDate=([^,\]]+)/;

function parseSprint(raw: string): SprintDescriptor | null {
	const id = SPRINT_ID.exec(raw)?.[1];
	if (!id) return null;
	const activated = SPRINT_ACTIVATED.exec(raw)?.[1];
	return {
		id: Number(id),
		name: SPRINT_NAME.exec(raw)?.[1] ?? "",
		state: SPRINT_STATE.exec(raw)?.[1] ?? "UNKNOWN",
		activatedAt: activated ? Date.parse(activated) || 0 : 0,
		raw,
	};
}

/**
 * The sprint a "current sprint" reference points at: the active sprint of the
 * project, the most recently activated one when several are active.
 */
async function currentSprint(
	projectId: string,
	fieldId: string,
): Promise<SprintDescriptor | null> {
	const rows = await db
		.select({ custom: issues.custom })
		.from(issues)
		.where(
			and(
				eq(issues.projectId, projectId),
				sql`exists (
					select 1
					from jsonb_array_elements_text(
						case
							when jsonb_typeof(${issues.custom} -> ${fieldId}) = 'array'
								then ${issues.custom} -> ${fieldId}
							else jsonb_build_array(${issues.custom} -> ${fieldId})
						end
					) as sprint(value)
					where sprint.value like '%state=ACTIVE%'
				)`,
			),
		);

	const active: SprintDescriptor[] = [];
	for (const row of rows) {
		const value = (row.custom as Record<string, unknown>)[fieldId];
		const list = Array.isArray(value) ? value : [value];
		for (const item of list) {
			if (typeof item !== "string") continue;
			const sprint = parseSprint(item);
			if (sprint?.state === "ACTIVE") active.push(sprint);
		}
	}
	active.sort(
		(left, right) => right.activatedAt - left.activatedAt || right.id - left.id,
	);
	return active[0] ?? null;
}

function isCreatedTrigger(trigger: Record<string, unknown>): boolean {
	const type = typeof trigger.type === "string" ? trigger.type : "";
	if (type.endsWith(":created")) return true;
	const value = trigger.value;
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { eventKey?: unknown }).eventKey === "jira:issue_created"
	);
}

/**
 * The imported automation rule in its normalized form: when a request is
 * created in the desk's project, set the sprint field to the project's current
 * sprint. Jira's "send notifications" part has no counterpart here.
 *
 * Automation is an extra on top of the request write, so a broken rule is
 * logged and reported in the outcome instead of failing the request.
 */
export async function applyCreateAutomation(
	issueId: string,
): Promise<AutomationOutcome> {
	const outcome: AutomationOutcome = { applied: [], skipped: [] };

	try {
		const [issue] = await db
			.select({
				id: issues.id,
				projectId: issues.projectId,
				custom: issues.custom,
			})
			.from(issues)
			.where(eq(issues.id, issueId))
			.limit(1);
		if (!issue) return outcome;

		const [desk] = await db
			.select({ id: serviceDesks.id })
			.from(serviceDesks)
			.where(eq(serviceDesks.projectId, issue.projectId))
			.limit(1);
		if (!desk) return outcome;

		const rules = await db
			.select({
				id: automationRules.id,
				name: automationRules.name,
				trigger: automationRules.trigger,
				conditions: automationRules.conditions,
				actions: automationRules.actions,
			})
			.from(automationRules)
			.where(
				and(
					eq(automationRules.deskId, desk.id),
					eq(automationRules.enabled, true),
				),
			)
			.orderBy(asc(automationRules.name));

		const custom = { ...(issue.custom as Record<string, unknown>) };
		const changes: Record<string, unknown> = {};
		const sprints = new Map<string, Promise<SprintDescriptor | null>>();

		for (const rule of rules) {
			if (!isCreatedTrigger(rule.trigger)) {
				outcome.skipped.push(`${rule.name}: trigger`);
				continue;
			}
			if (rule.conditions.length > 0) {
				outcome.skipped.push(`${rule.name}: conditions`);
				continue;
			}
			for (const action of rule.actions) {
				if (action.type !== "jira.issue.edit") {
					outcome.skipped.push(`${rule.name}: ${String(action.type)}`);
					continue;
				}
				const value = action.value as { operations?: EditOperation[] };
				for (const operation of value?.operations ?? []) {
					const reference = operation.value;
					const fieldId = operation.fieldId;
					if (!fieldId) {
						outcome.skipped.push(`${rule.name}: operation without a field`);
						continue;
					}
					if (
						operation.type !== "SET" ||
						reference?.type !== "REFERENCE" ||
						reference.value !== "CURRENT" ||
						operation.fieldType !== "com.pyxis.greenhopper.jira:gh-sprint"
					) {
						outcome.skipped.push(`${rule.name}: ${fieldId}`);
						continue;
					}
					let sprintLookup = sprints.get(fieldId);
					if (!sprintLookup) {
						sprintLookup = currentSprint(issue.projectId, fieldId);
						sprints.set(fieldId, sprintLookup);
					}
					const sprint = await sprintLookup;
					if (!sprint) {
						outcome.skipped.push(`${rule.name}: ${fieldId} has no sprint`);
						continue;
					}
					const next = [sprint.raw];
					if (JSON.stringify(custom[fieldId]) !== JSON.stringify(next)) {
						custom[fieldId] = next;
						changes[fieldId] = next;
					}
					outcome.applied.push(`${rule.name}: ${fieldId}=${sprint.name}`);
				}
			}
		}

		if (Object.keys(changes).length > 0) {
			await db
				.update(issues)
				.set({
					custom: sql`${issues.custom} || ${sql.param(JSON.stringify(changes))}::jsonb`,
					updated: new Date(),
				})
				.where(eq(issues.id, issue.id));
		}
		return outcome;
	} catch (error) {
		console.error(`automation failed for issue ${issueId}`, error);
		outcome.skipped.push("automation failed");
		return outcome;
	}
}
