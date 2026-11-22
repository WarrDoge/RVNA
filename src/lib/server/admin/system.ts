import {
	and,
	asc,
	desc,
	eq,
	gte,
	ilike,
	lt,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { endOfDay, startOfDay } from "#lib/dates.ts";
import type { CurrentUser } from "../auth.ts";
import { db, pool } from "../db.ts";
import { env } from "../env.ts";
import { HttpError } from "../http.ts";
import { requireAdminActor } from "../permissions.ts";
import { dateContext } from "../request-context.ts";
import { issueTypes, priorities } from "../schema.ts";
import { appSettings, auditLog } from "../schema-admin.ts";
import {
	defaultIssueTypeKey,
	defaultPriorityKey,
	readSiteSettings,
	siteTitleKey,
} from "../site.ts";
import { audit } from "./audit.ts";

export const settingsBody = z.object({
	title: z
		.string()
		.trim()
		.min(1, "The site title cannot be empty")
		.max(100, "The site title cannot be longer than 100 characters"),
	defaultIssueTypeId: z.uuid().nullable(),
	defaultPriorityId: z.uuid().nullable(),
});

/** Audit rows are shared by every slice; never assume a row count. */
const auditFilterShape = {
	actor: z.string().trim().max(200).optional(),
	action: z.string().trim().max(200).optional(),
	entityType: z.string().trim().max(200).optional(),
	from: z
		.string()
		.trim()
		.refine((value) => !Number.isNaN(Date.parse(value)), {
			message: "Use a date such as 2026-01-31",
		})
		.optional(),
	to: z
		.string()
		.trim()
		.refine((value) => !Number.isNaN(Date.parse(value)), {
			message: "Use a date such as 2026-01-31",
		})
		.optional(),
	query: z.string().trim().max(200).optional(),
};

export const auditFilterSchema = z.object(auditFilterShape);

export const auditListQuery = z.object({
	...auditFilterShape,
	offset: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).default(50),
});

type AuditFilters = z.infer<typeof auditFilterSchema>;

export const auditEntrySchema = z.object({
	id: z.uuid(),
	createdAt: z.iso.datetime(),
	actor: z.object({ id: z.uuid().nullable(), name: z.string() }),
	action: z.string(),
	entityType: z.string(),
	entityId: z.string().nullable(),
	summary: z.string(),
	changes: z.unknown(),
});

export const auditPageSchema = z.object({
	entries: z.array(auditEntrySchema),
	total: z.number().int(),
});

export const auditFilterOptionsSchema = z.object({
	actions: z.array(z.string()),
	entityTypes: z.array(z.string()),
	actors: z.array(z.object({ id: z.uuid().nullable(), name: z.string() })),
});

export const systemInfoSchema = z.object({
	version: z.string().nullable(),
	node: z.string(),
	postgres: z.string(),
	migrationCount: z.number().int(),
	counts: z.object({
		users: z.number().int(),
		activeUsers: z.number().int(),
		projects: z.number().int(),
		issues: z.number().int(),
		attachments: z.number().int(),
	}),
	attachmentBytes: z.number(),
	appUrl: z.string(),
	uptimeSeconds: z.number(),
	startedAt: z.iso.datetime(),
});

const auditColumns = {
	id: auditLog.id,
	createdAt: auditLog.createdAt,
	actorId: auditLog.actorId,
	actorName: auditLog.actorName,
	action: auditLog.action,
	entityType: auditLog.entityType,
	entityId: auditLog.entityId,
	summary: auditLog.summary,
	changes: auditLog.changes,
};

function escapeLike(value: string) {
	return value.replace(/[%_\\]/g, "\\$&");
}

function auditWhere(filters: AuditFilters) {
	const conditions: SQL[] = [];

	if (filters.actor) {
		const actorId = z.uuid().safeParse(filters.actor);
		conditions.push(
			actorId.success
				? eq(auditLog.actorId, actorId.data)
				: sql`lower(${auditLog.actorName}) = lower(${filters.actor})`,
		);
	}

	if (filters.action) {
		conditions.push(
			filters.action.endsWith("*")
				? ilike(auditLog.action, `${escapeLike(filters.action.slice(0, -1))}%`)
				: eq(auditLog.action, filters.action),
		);
	}

	if (filters.entityType) {
		conditions.push(eq(auditLog.entityType, filters.entityType));
	}
	const timeZone = dateContext().timeZone;
	if (filters.from) {
		const from = /^\d{4}-\d{2}-\d{2}$/.test(filters.from)
			? startOfDay(filters.from, timeZone)
			: filters.from;
		conditions.push(gte(auditLog.createdAt, new Date(from)));
	}
	if (filters.to) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) {
			const next = new Date(endOfDay(filters.to, timeZone));
			next.setUTCMilliseconds(next.getUTCMilliseconds() + 1);
			conditions.push(lt(auditLog.createdAt, next));
		} else {
			conditions.push(lte(auditLog.createdAt, new Date(filters.to)));
		}
	}
	if (filters.query) {
		const pattern = `%${escapeLike(filters.query)}%`;
		conditions.push(
			or(
				ilike(auditLog.summary, pattern),
				ilike(auditLog.actorName, pattern),
				ilike(auditLog.action, pattern),
			) as SQL,
		);
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}

async function loadAuditRowsPage(
	filters: AuditFilters,
	page: { offset: number; limit: number },
) {
	return db
		.select(auditColumns)
		.from(auditLog)
		.where(auditWhere(filters))
		.orderBy(desc(auditLog.createdAt), desc(auditLog.id))
		.limit(page.limit)
		.offset(page.offset);
}

async function loadAuditRows(
	filters: AuditFilters,
	page: { offset: number; limit: number },
) {
	const where = auditWhere(filters);
	const [rows, totals] = await Promise.all([
		loadAuditRowsPage(filters, page),
		db
			.select({ total: sql<number>`count(*)::int` })
			.from(auditLog)
			.where(where),
	]);

	return { rows, total: totals[0]?.total ?? 0 };
}

function toEntry(
	row: Awaited<ReturnType<typeof loadAuditRows>>["rows"][number],
) {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		actor: { id: row.actorId, name: row.actorName },
		action: row.action,
		entityType: row.entityType,
		entityId: row.entityId,
		summary: row.summary,
		changes: row.changes,
	};
}

/** A CSV cell: quoted when needed, and never a formula Excel would run. */
function csvCell(value: unknown) {
	let text =
		value === null || value === undefined
			? ""
			: typeof value === "string"
				? value
				: JSON.stringify(value);
	if (/^[=+\-@\t\r\n]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function getSettings(actor: CurrentUser) {
	requireAdminActor(actor);
	return readSiteSettings();
}

export async function updateSettings(
	actor: CurrentUser,
	body: z.infer<typeof settingsBody>,
) {
	requireAdminActor(actor);
	const before = await readSiteSettings();

	if (body.defaultIssueTypeId) {
		const [issueType] = await db
			.select({ subtask: issueTypes.subtask })
			.from(issueTypes)
			.where(eq(issueTypes.id, body.defaultIssueTypeId));
		if (!issueType) {
			throw new HttpError(400, "That issue type does not exist");
		}
		if (issueType.subtask) {
			throw new HttpError(400, "The default issue type cannot be a sub-task");
		}
	}

	if (body.defaultPriorityId) {
		const [priority] = await db
			.select({ id: priorities.id })
			.from(priorities)
			.where(eq(priorities.id, body.defaultPriorityId));
		if (!priority) {
			throw new HttpError(400, "That priority does not exist");
		}
	}

	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	const labels: string[] = [];
	const rows: { key: string; value: string | null }[] = [];
	if (body.title !== before.title) {
		from.title = before.title;
		to.title = body.title;
		labels.push("title");
		rows.push({ key: siteTitleKey, value: body.title });
	}
	if (body.defaultIssueTypeId !== before.defaultIssueTypeId) {
		from.defaultIssueTypeId = before.defaultIssueTypeId;
		to.defaultIssueTypeId = body.defaultIssueTypeId;
		labels.push("default issue type");
		rows.push({ key: defaultIssueTypeKey, value: body.defaultIssueTypeId });
	}
	if (body.defaultPriorityId !== before.defaultPriorityId) {
		from.defaultPriorityId = before.defaultPriorityId;
		to.defaultPriorityId = body.defaultPriorityId;
		labels.push("default priority");
		rows.push({ key: defaultPriorityKey, value: body.defaultPriorityId });
	}

	if (labels.length === 0) return before;

	const updatedAt = new Date();

	await db.transaction(async (tx) => {
		for (const row of rows) {
			// A cleared default has no row at all; jsonb cannot hold SQL null.
			if (row.value === null) {
				await tx.delete(appSettings).where(eq(appSettings.key, row.key));
				continue;
			}
			await tx
				.insert(appSettings)
				.values({ key: row.key, value: row.value, updatedAt })
				.onConflictDoUpdate({
					target: appSettings.key,
					set: { value: row.value, updatedAt },
				});
		}
		await audit(tx, actor, {
			action: "settings.update",
			entityType: "settings",
			entityId: null,
			summary: `Updated general configuration (${labels.join(", ")})`,
			changes: { from, to },
		});
	});

	return {
		title: body.title,
		baseUrl: before.baseUrl,
		defaultIssueTypeId: body.defaultIssueTypeId,
		defaultPriorityId: body.defaultPriorityId,
	};
}

export async function listAudit(
	actor: CurrentUser,
	query: z.infer<typeof auditListQuery>,
) {
	requireAdminActor(actor);
	const { offset, limit, ...filters } = query;
	const { rows, total } = await loadAuditRows(filters, {
		offset,
		limit: Math.min(limit, 200),
	});
	return { entries: rows.map(toEntry), total };
}

export async function getAuditFilterOptions(actor: CurrentUser) {
	requireAdminActor(actor);
	const [actions, entityTypes, actors] = await Promise.all([
		db
			.selectDistinct({ action: auditLog.action })
			.from(auditLog)
			.orderBy(asc(auditLog.action)),
		db
			.selectDistinct({ entityType: auditLog.entityType })
			.from(auditLog)
			.orderBy(asc(auditLog.entityType)),
		db
			.select({ id: auditLog.actorId, name: auditLog.actorName })
			.from(auditLog)
			.groupBy(auditLog.actorId, auditLog.actorName)
			.orderBy(asc(auditLog.actorName)),
	]);

	return {
		actions: actions.map((row) => row.action),
		entityTypes: entityTypes.map((row) => row.entityType),
		actors,
	};
}

const AUDIT_EXPORT_PAGE_SIZE = 10_000;

export async function exportAuditCsv(
	actor: CurrentUser,
	filters: AuditFilters,
) {
	requireAdminActor(actor);

	const lines = [
		["When", "Who", "Action", "Entity type", "Entity id", "Summary", "Changes"]
			.map(csvCell)
			.join(","),
	];
	for (let offset = 0; ; ) {
		const rows = await loadAuditRowsPage(filters, {
			offset,
			limit: AUDIT_EXPORT_PAGE_SIZE,
		});
		for (const row of rows) {
			lines.push(
				[
					row.createdAt.toISOString(),
					row.actorName,
					row.action,
					row.entityType,
					row.entityId ?? "",
					row.summary,
					row.changes ?? "",
				]
					.map(csvCell)
					.join(","),
			);
		}
		if (rows.length < AUDIT_EXPORT_PAGE_SIZE) break;
		offset += rows.length;
	}

	return `${lines.join("\r\n")}\r\n`;
}

export async function getSystemInfo(actor: CurrentUser) {
	requireAdminActor(actor);
	const { rows } = await pool.query<{
		postgres_version: string;
		users: number;
		active_users: number;
		projects: number;
		issues: number;
		attachments: number;
		attachment_bytes: number;
		migrations: number;
	}>(`
		select
			version() as postgres_version,
			(select count(*)::int from users) as users,
			(select count(*)::int from users where active) as active_users,
			(select count(*)::int from projects) as projects,
			(select count(*)::int from issues) as issues,
			(select count(*)::int from attachments) as attachments,
			(select coalesce(sum(size), 0)::float8 from attachments) as attachment_bytes,
			(select count(*)::int from drizzle.__drizzle_migrations) as migrations
	`);

	const row = rows[0];
	const uptimeSeconds = Math.floor(process.uptime());
	const version = process.env.APP_VERSION?.trim();

	return {
		version: version ? version : null,
		node: process.version,
		postgres: row.postgres_version.split(" ").slice(0, 2).join(" "),
		migrationCount: row.migrations,
		counts: {
			users: row.users,
			activeUsers: row.active_users,
			projects: row.projects,
			issues: row.issues,
			attachments: row.attachments,
		},
		attachmentBytes: row.attachment_bytes,
		appUrl: env.APP_URL,
		uptimeSeconds,
		startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
	};
}
