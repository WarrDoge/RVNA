import { isDeepStrictEqual } from "node:util";
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { db } from "./db.ts";

export type Executor = Pick<
	typeof db,
	"select" | "insert" | "update" | "delete"
>;

export interface RowCounts {
	inserted: number;
	updated: number;
	unchanged: number;
}

export type ImportCounts = Record<string, RowCounts>;

export interface UpsertResult {
	counts: RowCounts;
	ids: Map<string, string>;
	keptLocalIds: string[];
}

export function emptyCounts(): RowCounts {
	return { inserted: 0, updated: 0, unchanged: 0 };
}

export function mergeCounts(
	counts: ImportCounts,
	table: string,
	rowCounts: RowCounts,
) {
	const target = counts[table] ?? emptyCounts();
	target.inserted += rowCounts.inserted;
	target.updated += rowCounts.updated;
	target.unchanged += rowCounts.unchanged;
	counts[table] = target;
}

const KEY_CHUNK = 500;

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

export interface UpsertOptions {
	preserveNullKeys?: string[];
	advanceKeys?: string[];
	/**
	 * The text column the key is read from. The existing rows are then loaded for
	 * the given keys only, not the whole table, which keeps big bodies out of memory.
	 */
	keyColumn?: PgColumn;
	/** Rows whose marker is set are kept; the import never overwrites a local change. */
	localChangeColumn?: PgColumn;
	/** The deliberate reset: overwrite marked rows and clear their marker. */
	overwriteLocal?: boolean;
	/** Version rows may collide with a local version at the same number. */
	onConflictDoNothing?: boolean;
}

type CachedRow = Record<string, unknown>;

interface TableCache {
	rows: Map<string, CachedRow>;
	loaded: boolean;
	requested: Set<string>;
}

const transactionCache = new WeakMap<object, Map<PgTable, TableCache>>();

function tableCache(tx: object, table: PgTable): TableCache {
	let byTable = transactionCache.get(tx);
	if (!byTable) {
		byTable = new Map();
		transactionCache.set(tx, byTable);
	}
	let cache = byTable.get(table);
	if (!cache) {
		cache = { rows: new Map(), loaded: false, requested: new Set() };
		byTable.set(table, cache);
	}
	return cache;
}

function isEmptyValue(value: unknown): boolean {
	if (Array.isArray(value)) return value.length === 0;
	return (
		typeof value === "object" &&
		value !== null &&
		Object.keys(value).length === 0
	);
}

function customValuesEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (
		left === null ||
		left === undefined ||
		right === null ||
		right === undefined
	) {
		return (
			((left === null || left === undefined) && isEmptyValue(right)) ||
			((right === null || right === undefined) && isEmptyValue(left))
		);
	}
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) => customValuesEqual(value, right[index]))
		);
	}
	if (typeof left === "object" && typeof right === "object") {
		const leftObject = left as Record<string, unknown>;
		const rightObject = right as Record<string, unknown>;
		for (const key of new Set([
			...Object.keys(leftObject),
			...Object.keys(rightObject),
		])) {
			if (key === "elapsedTime" || key === "remainingTime") continue;
			const leftValue = leftObject[key];
			const rightValue = rightObject[key];
			if (
				(leftValue === undefined && isEmptyValue(rightValue)) ||
				(rightValue === undefined && isEmptyValue(leftValue))
			) {
				continue;
			}
			if (!customValuesEqual(leftValue, rightValue)) return false;
		}
		return true;
	}
	return false;
}

export async function upsertRows(
	tx: Executor,
	table: PgTable,
	rows: Record<string, unknown>[],
	keyOf: (row: Record<string, unknown>) => string,
	options: UpsertOptions = {},
): Promise<UpsertResult> {
	const counts = emptyCounts();
	const ids = new Map<string, string>();
	const keptLocalIds: string[] = [];
	if (rows.length === 0) return { counts, ids, keptLocalIds };

	const columns = getTableColumns(table) as Record<string, PgColumn>;
	const idColumn = columns.id;
	const cache = tableCache(tx, table);
	if (options.keyColumn) {
		const wanted = rows.map(keyOf).filter((key) => !cache.requested.has(key));
		for (const chunk of chunks(wanted, KEY_CHUNK)) {
			const existingRows = (await tx
				.select()
				.from(table)
				.where(
					sql`${options.keyColumn} = any(${sql.param(chunk)}::text[])`,
				)) as CachedRow[];
			for (const row of existingRows) cache.rows.set(keyOf(row), row);
			for (const key of chunk) cache.requested.add(key);
		}
	} else if (!cache.loaded) {
		const existingRows = (await tx.select().from(table)) as CachedRow[];
		for (const row of existingRows) cache.rows.set(keyOf(row), row);
		cache.loaded = true;
	}

	const inserts: CachedRow[] = [];
	for (const row of rows) {
		const key = keyOf(row);
		const existing = cache.rows.get(key);
		if (!existing) {
			inserts.push(row);
			continue;
		}

		ids.set(key, String(existing.id));
		if (
			options.localChangeColumn &&
			!options.overwriteLocal &&
			existing.locallyChangedAt
		) {
			keptLocalIds.push(String(existing.id));
			continue;
		}
		let changed = false;
		const updateValues: CachedRow = { ...row };
		if (columns.updatedAt) updateValues.updatedAt = new Date();
		if (options.localChangeColumn) {
			// The importer always writes this sentinel; the trigger turns it into NULL.
			// An application update never writes it, so the trigger sets the marker.
			updateValues.locallyChangedAt = sql`'epoch'::timestamptz`;
		}
		for (const [column, value] of Object.entries(row)) {
			if (value === undefined) {
				delete updateValues[column];
				continue;
			}
			if (column === "updatedAt") continue;
			if (column === "id" || column === "createdAt") {
				delete updateValues[column];
				continue;
			}
			if (options.advanceKeys?.includes(column)) {
				if (Number(value ?? 0) > Number(existing[column] ?? 0)) {
					changed = true;
					updateValues[column] = sql`greatest(${columns[column]}, ${value})`;
				} else {
					delete updateValues[column];
				}
				continue;
			}
			if (
				options.preserveNullKeys?.includes(column) &&
				value === null &&
				existing[column] !== null
			) {
				delete updateValues[column];
				continue;
			}
			if (column === "custom") {
				if (!customValuesEqual(existing[column], value)) changed = true;
				continue;
			}
			if (!isDeepStrictEqual(existing[column], value)) changed = true;
		}
		if (!changed) {
			counts.unchanged++;
			continue;
		}

		const conditions = [eq(idColumn, String(existing.id))];
		if (options.localChangeColumn && !options.overwriteLocal) {
			conditions.push(isNull(options.localChangeColumn));
		}
		const updated = await tx
			.update(table)
			.set(updateValues as never)
			.where(and(...conditions))
			.returning({ id: idColumn });
		if (updated.length === 0 && options.localChangeColumn) {
			keptLocalIds.push(String(existing.id));
			continue;
		}
		counts.updated++;
		const cached: CachedRow = { ...existing, ...updateValues };
		if (options.localChangeColumn) cached.locallyChangedAt = null;
		for (const column of options.advanceKeys ?? []) {
			if (row[column] === undefined) continue;
			cached[column] = Math.max(
				Number(existing[column] ?? 0),
				Number(row[column] ?? 0),
			);
		}
		cache.rows.set(key, cached);
	}

	for (const chunk of chunks(inserts, 100)) {
		const insert = tx.insert(table).values(chunk as never);
		if (options.onConflictDoNothing) {
			const returned = (await insert
				.onConflictDoNothing()
				.returning()) as CachedRow[];
			for (const row of returned) {
				const key = keyOf(row);
				ids.set(key, String(row.id));
				cache.rows.set(key, row);
			}
			counts.inserted += returned.length;
			continue;
		}
		const returned = (await insert.returning({ id: idColumn })) as {
			id: string;
		}[];
		for (let index = 0; index < chunk.length; index++) {
			const key = keyOf(chunk[index]);
			ids.set(key, String(returned[index].id));
			cache.rows.set(key, { ...chunk[index], id: returned[index].id });
		}
		counts.inserted += chunk.length;
	}

	return { counts, ids, keptLocalIds };
}

export function formatLocalChanges(
	localChanges: Record<string, string[]>,
	overwriteLocal: boolean,
) {
	const tables = [
		"pages",
		"issues",
		...Object.keys(localChanges).filter(
			(table) =>
				table !== "pages" &&
				table !== "issues" &&
				(localChanges[table]?.length ?? 0) > 0,
		),
	];
	const parts = tables.map((table) => {
		const ids = localChanges[table] ?? [];
		return `${table} ${ids.length}${ids.length > 0 ? ` (ids ${ids.join(", ")})` : ""}`;
	});
	return `kept local changes: ${parts.join(", ")}${
		overwriteLocal ? " (overwrite-local on)" : ""
	}`;
}

export function printCounts(counts: ImportCounts) {
	for (const table of Object.keys(counts).sort()) {
		const row = counts[table];
		console.log(
			`${table}: inserted=${row.inserted} updated=${row.updated} unchanged=${row.unchanged}`,
		);
	}
}
