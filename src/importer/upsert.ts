import { isDeepStrictEqual } from "node:util";
import { getTableColumns, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { db } from "./db.ts";

export type Executor = Pick<
	typeof db,
	"select" | "insert" | "update" | "delete" | "execute"
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

interface PendingUpdate {
	key: string;
	existingId: string;
	existing: CachedRow;
	row: CachedRow;
	values: CachedRow;
}

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
	// Custom values are a keyed bag: an empty value and an absent key mean the same.
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

const UPDATE_CHUNK = 100;

async function flushUpdates(
	tx: Executor,
	table: PgTable,
	columns: Record<string, PgColumn>,
	pending: PendingUpdate[],
	options: UpsertOptions,
	localChangeKey: string | null,
	counts: RowCounts,
	ids: Map<string, string>,
	keptLocalIds: string[],
	cache: TableCache,
) {
	const groups = new Map<string, PendingUpdate[]>();
	for (const update of pending) {
		const groupKey = Object.keys(update.values).sort().join("\u0000");
		const group = groups.get(groupKey) ?? [];
		group.push(update);
		groups.set(groupKey, group);
	}

	for (const group of groups.values()) {
		const keys = Object.keys(group[0]?.values ?? {}).sort();
		const valueKeys = keys.filter((key) => key !== localChangeKey);
		const idColumn = columns.id;
		const columnNames = [
			idColumn.name,
			...valueKeys.map((key) => columns[key].name),
		];
		for (const chunk of chunks(group, UPDATE_CHUNK)) {
			const rows = chunk.map((update) => {
				const values = [
					sql`${sql.param(update.existingId)}::${sql.raw(idColumn.getSQLType())}`,
					...valueKeys.map((key) => {
						const column = columns[key];
						const value = options.advanceKeys?.includes(key)
							? update.row[key]
							: update.values[key];
						const mapped =
							value === null ? null : column.mapToDriverValue(value);
						return sql`${sql.param(mapped)}::${sql.raw(column.getSQLType())}`;
					}),
				];
				return sql`(${sql.join(values, sql`, `)})`;
			});
			const assignments = keys.map((key) => {
				const name = columns[key].name;
				if (key === localChangeKey) {
					return sql`${sql.identifier(name)} = 'epoch'::timestamptz`;
				}
				if (options.advanceKeys?.includes(key)) {
					return sql`${sql.identifier(name)} = greatest(target.${sql.identifier(name)}, v.${sql.identifier(name)})`;
				}
				return sql`${sql.identifier(name)} = v.${sql.identifier(name)}`;
			});
			const marker =
				options.localChangeColumn && !options.overwriteLocal
					? sql` and target.${sql.identifier(options.localChangeColumn.name)} is null`
					: sql``;
			const query = sql`
				update ${table} as target
				set ${sql.join(assignments, sql`, `)}
				from (values ${sql.join(rows, sql`, `)}) as v(${sql.join(
					columnNames.map((name) => sql.identifier(name)),
					sql`, `,
				)})
				where target.${sql.identifier(idColumn.name)} = v.${sql.identifier(idColumn.name)}${marker}
				returning target.${sql.identifier(idColumn.name)} as id
			`;
			const result = await tx.execute<{ id: string }>(query);
			const updatedIds = new Set(result.rows.map((row) => String(row.id)));
			for (const update of chunk) {
				if (updatedIds.has(update.existingId)) {
					counts.updated++;
					const cached: CachedRow = { ...update.existing, ...update.values };
					if (localChangeKey) cached[localChangeKey] = null;
					for (const column of options.advanceKeys ?? []) {
						if (update.row[column] === undefined) continue;
						cached[column] = Math.max(
							Number(update.existing[column] ?? 0),
							Number(update.row[column] ?? 0),
						);
					}
					cache.rows.set(update.key, cached);
					continue;
				}
				if (options.localChangeColumn && !options.overwriteLocal) {
					keptLocalIds.push(update.existingId);
					continue;
				}
				ids.delete(update.key);
				cache.rows.delete(update.key);
			}
		}
	}
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
	rows = [...new Map(rows.map((row) => [keyOf(row), row])).values()];

	const columns = getTableColumns(table) as Record<string, PgColumn>;
	const localChangeKey = options.localChangeColumn
		? (Object.keys(columns).find(
				(key) => columns[key] === options.localChangeColumn,
			) ?? options.localChangeColumn.name)
		: null;
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
	const pending: PendingUpdate[] = [];
	for (const row of rows) {
		const key = keyOf(row);
		const existing = cache.rows.get(key);
		if (!existing) {
			inserts.push(row);
			continue;
		}

		ids.set(key, String(existing.id));
		if (localChangeKey && !options.overwriteLocal && existing[localChangeKey]) {
			keptLocalIds.push(String(existing.id));
			continue;
		}
		let changed = false;
		if (localChangeKey && options.overwriteLocal && existing[localChangeKey]) {
			changed = true;
		}
		const updateValues: CachedRow = { ...row };
		if (columns.updatedAt) updateValues.updatedAt = new Date();
		if (localChangeKey) {
			// The importer always writes this sentinel; the trigger turns it into NULL.
			// An application update never writes it, so the trigger sets the marker.
			updateValues[localChangeKey] = sql`'epoch'::timestamptz`;
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

		pending.push({
			key,
			existingId: String(existing.id),
			existing,
			row,
			values: updateValues,
		});
	}

	await flushUpdates(
		tx,
		table,
		columns,
		pending,
		options,
		localChangeKey,
		counts,
		ids,
		keptLocalIds,
		cache,
	);

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
		const returned = (await insert.returning()) as CachedRow[];
		if (returned.length !== chunk.length) {
			throw new Error(
				`inserting ${chunk.length} rows returned ${returned.length} rows`,
			);
		}
		const returnedByKey = new Map(returned.map((row) => [keyOf(row), row]));
		for (const row of chunk) {
			const key = keyOf(row);
			const inserted = returnedByKey.get(key);
			if (!inserted) {
				throw new Error(`inserting rows did not return ${key}`);
			}
			ids.set(key, String(inserted.id));
			cache.rows.set(key, inserted);
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
