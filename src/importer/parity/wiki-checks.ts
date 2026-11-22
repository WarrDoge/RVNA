import {
	check,
	compareSets,
	skipped,
	sorted,
	symmetricDifference,
	wikiRequiredColumns,
} from "./checks.ts";
import type {
	CheckResult,
	TableSet,
	WikiDatabaseSnapshot,
	WikiLiveSnapshot,
} from "./types.ts";

function pageIdsBySpaceStatus(
	pages: Map<string, { spaceKey: string; status: string }>,
) {
	const result = new Map<string, Map<string, Set<string>>>();
	for (const [sourceId, page] of pages) {
		const statuses = result.get(page.spaceKey) ?? new Map();
		const ids = statuses.get(page.status) ?? new Set();
		ids.add(sourceId);
		statuses.set(page.status, ids);
		result.set(page.spaceKey, statuses);
	}
	return result;
}

function unionKeys(left: Iterable<string>, right: Iterable<string>) {
	return sorted([...new Set([...left, ...right])]);
}

function withoutLocal<T>(
	map: Map<string, T>,
	localPages: Set<string>,
): Map<string, T> {
	return new Map([...map].filter(([sourceId]) => !localPages.has(sourceId)));
}

function socialCheck(
	name: string,
	live: Map<string, number>,
	database: Map<string, number>,
): CheckResult {
	const keys = unionKeys(live.keys(), database.keys());
	let liveTotal = 0;
	let dbTotal = 0;
	const details: string[] = [];
	for (const key of keys) {
		const liveCount = live.get(key) ?? 0;
		const dbCount = database.get(key) ?? 0;
		liveTotal += liveCount;
		dbTotal += dbCount;
		if (liveCount !== dbCount) details.push(key);
	}
	return check(name, liveTotal, dbTotal, details);
}

export function wikiChecks(
	live: WikiLiveSnapshot,
	database: WikiDatabaseSnapshot,
	tables: TableSet,
): CheckResult[] {
	const checks: CheckResult[] = [];
	const localPages = database.localPages ?? new Set<string>();
	const livePages = withoutLocal(live.pages, localPages);
	const dbPagesAll = withoutLocal(database.pages, localPages);
	const localCheck = check(
		"confluence.local_changes",
		localPages.size,
		localPages.size,
	);
	localCheck.note = `local changes kept: ${localPages.size}`;
	checks.push(localCheck);

	checks.push(
		compareSets(
			"confluence.spaces",
			live.spaces.map((space) => space.key),
			database.spaces.map((space) => space.key),
		),
	);

	if (tables.has("spaces") && tables.has("pages")) {
		const livePageSets = pageIdsBySpaceStatus(livePages);
		const dbPageSets = pageIdsBySpaceStatus(dbPagesAll);
		const spaces = unionKeys(
			live.spaces.map((space) => space.key),
			database.spaces.map((space) => space.key),
		);
		for (const space of spaces) {
			for (const status of ["current", "draft", "trashed"]) {
				const liveSet =
					livePageSets.get(space)?.get(status) ?? new Set<string>();
				const dbSet = dbPageSets.get(space)?.get(status) ?? new Set<string>();
				checks.push(
					check(
						`confluence.space.${space}.pages.${status}`,
						liveSet.size,
						dbSet.size,
						symmetricDifference(liveSet, dbSet),
					),
				);
			}
		}
	} else {
		checks.push(
			skipped("confluence.pages", "wiki spaces/pages tables are not present"),
		);
	}

	if (tables.hasColumns("page_versions", wikiRequiredColumns.page_versions)) {
		const liveVersions = withoutLocal(live.versions, localPages);
		const dbVersions = withoutLocal(database.versions, localPages);
		const pages = unionKeys(liveVersions.keys(), dbVersions.keys());
		let liveTotal = 0;
		let dbTotal = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveCount = liveVersions.get(page) ?? 0;
			const dbCount = dbVersions.get(page) ?? 0;
			liveTotal += liveCount;
			dbTotal += dbCount;
			if (liveCount !== dbCount) details.push(page);
		}
		checks.push(check("confluence.versions", liveTotal, dbTotal, details));
	} else {
		checks.push(
			skipped(
				"confluence.versions",
				"page_versions table or its columns are not present",
			),
		);
	}

	if (tables.hasColumns("page_comments", wikiRequiredColumns.page_comments)) {
		const liveComments = withoutLocal(live.comments, localPages);
		const dbComments = withoutLocal(database.comments, localPages);
		const pages = unionKeys(liveComments.keys(), dbComments.keys());
		for (const kind of ["page", "inline"] as const) {
			let liveTotal = 0;
			let dbTotal = 0;
			const details: string[] = [];
			for (const page of pages) {
				const liveCount = liveComments.get(page)?.[kind] ?? 0;
				const dbCount = dbComments.get(page)?.[kind] ?? 0;
				liveTotal += liveCount;
				dbTotal += dbCount;
				if (liveCount !== dbCount) details.push(page);
			}
			checks.push(
				check(`confluence.comments.${kind}`, liveTotal, dbTotal, details),
			);
		}
	} else {
		checks.push(
			skipped(
				"confluence.comments",
				"page_comments table or its columns are not present",
			),
		);
	}

	if (
		tables.hasColumns("page_attachments", wikiRequiredColumns.page_attachments)
	) {
		const liveAttachments = withoutLocal(live.attachments, localPages);
		const dbAttachments = withoutLocal(database.attachments, localPages);
		const pages = unionKeys(liveAttachments.keys(), dbAttachments.keys());
		let liveTotal = 0;
		let dbTotal = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveIds = new Set(
				(liveAttachments.get(page) ?? []).map((item) => item.sourceId),
			);
			const dbIds = new Set(
				(dbAttachments.get(page) ?? []).map((item) => item.sourceId),
			);
			liveTotal += liveIds.size;
			dbTotal += dbIds.size;
			details.push(...symmetricDifference(liveIds, dbIds));
		}
		checks.push(check("confluence.attachments", liveTotal, dbTotal, details));

		const dbSample = new Map<string, { size: number; sha256: string }>();
		for (const items of dbAttachments.values()) {
			for (const item of items) {
				dbSample.set(item.sourceId, {
					size: item.size,
					sha256: item.sha256,
				});
			}
		}
		const liveSample = live.attachmentSample.filter(
			(item) => !localPages.has(item.pageSourceId),
		);
		const sampleDetails: string[] = [];
		const sizeDetails: string[] = [];
		let sampleMatches = 0;
		let liveBytes = 0;
		let dbBytes = 0;
		for (const item of liveSample) {
			liveBytes += item.size;
			const stored = dbSample.get(item.sourceId);
			dbBytes += stored?.size ?? 0;
			if (stored && stored.size !== item.size) {
				sizeDetails.push(item.sourceId);
			}
			if (
				stored &&
				stored.size === item.size &&
				stored.sha256 === item.sha256
			) {
				sampleMatches++;
			} else {
				sampleDetails.push(item.sourceId);
			}
		}
		checks.push(
			check(
				"confluence.attachments.sample",
				liveSample.length,
				sampleMatches,
				sampleDetails,
			),
			check(
				"confluence.attachments.sample_bytes",
				liveBytes,
				dbBytes,
				sizeDetails,
			),
		);
	} else {
		checks.push(
			skipped(
				"confluence.attachments",
				"page_attachments table or its columns are not present",
			),
			skipped(
				"confluence.attachments.sample",
				"page_attachments table or its columns are not present",
			),
			skipped(
				"confluence.attachments.sample_bytes",
				"page_attachments table or its columns are not present",
			),
		);
	}

	if (tables.hasColumns("page_labels", wikiRequiredColumns.page_labels)) {
		const liveLabels = new Map(
			[...livePages.entries()].map(([key, page]) => [key, page.labels]),
		);
		const dbLabels = withoutLocal(database.labels, localPages);
		const pages = unionKeys(liveLabels.keys(), dbLabels.keys());
		const details: string[] = [];
		let liveTotal = 0;
		let dbTotal = 0;
		for (const page of pages) {
			const liveValues = new Set(liveLabels.get(page) ?? []);
			const dbValues = new Set(dbLabels.get(page) ?? []);
			liveTotal += liveValues.size;
			dbTotal += dbValues.size;
			if (symmetricDifference(liveValues, dbValues).length > 0) {
				details.push(page);
			}
		}
		checks.push(check("confluence.labels", liveTotal, dbTotal, details));
	} else {
		checks.push(
			skipped(
				"confluence.labels",
				"page_labels table or its columns are not present",
			),
		);
	}

	if (
		tables.hasColumns(
			"page_restrictions",
			wikiRequiredColumns.page_restrictions,
		)
	) {
		const liveRestrictions = new Map(
			[...livePages.entries()].map(([key, page]) => [key, page.restrictions]),
		);
		const dbRestrictions = withoutLocal(database.restrictions, localPages);
		const pages = unionKeys(liveRestrictions.keys(), dbRestrictions.keys());
		const details: string[] = [];
		let liveTotal = 0;
		let dbTotal = 0;
		for (const page of pages) {
			const liveValues = new Set(liveRestrictions.get(page) ?? []);
			const dbValues = new Set(dbRestrictions.get(page) ?? []);
			liveTotal += liveValues.size;
			dbTotal += dbValues.size;
			if (symmetricDifference(liveValues, dbValues).length > 0) {
				details.push(page);
			}
		}
		checks.push(check("confluence.restrictions", liveTotal, dbTotal, details));
	} else {
		checks.push(
			skipped(
				"confluence.restrictions",
				"page_restrictions table or its columns are not present",
			),
		);
	}

	if (
		tables.hasColumns(
			"space_permissions",
			wikiRequiredColumns.space_permissions,
		)
	) {
		const spaces = unionKeys(
			live.spaces.map((space) => space.key),
			database.spaces.map((space) => space.key),
		);
		for (const space of spaces) {
			const liveValues = new Set(live.permissions.get(space) ?? []);
			const dbValues = new Set(database.permissions.get(space) ?? []);
			checks.push(
				check(
					`confluence.space.${space}.permissions`,
					liveValues.size,
					dbValues.size,
					symmetricDifference(liveValues, dbValues),
				),
			);
		}
	} else {
		checks.push(
			skipped(
				"confluence.permissions",
				"space_permissions table or its columns are not present",
			),
		);
	}

	if (tables.hasColumns("page_watchers", wikiRequiredColumns.page_watchers)) {
		checks.push(
			live.watchersSkipped
				? skipped(
						"wiki.page_watchers",
						"watchers are skipped without --private-apis",
					)
				: socialCheck(
						"wiki.page_watchers",
						withoutLocal(live.pageWatchers, localPages),
						withoutLocal(database.pageWatchers, localPages),
					),
		);
	} else {
		checks.push(
			skipped(
				"wiki.page_watchers",
				"page_watchers table or its columns are not present",
			),
		);
	}

	if (tables.hasColumns("space_watchers", wikiRequiredColumns.space_watchers)) {
		checks.push(
			live.watchersSkipped
				? skipped(
						"wiki.space_watchers",
						"watchers are skipped without --private-apis",
					)
				: socialCheck(
						"wiki.space_watchers",
						live.spaceWatchers,
						database.spaceWatchers,
					),
		);
	} else {
		checks.push(
			skipped(
				"wiki.space_watchers",
				"space_watchers table or its columns are not present",
			),
		);
	}

	if (tables.hasColumns("page_likes", wikiRequiredColumns.page_likes)) {
		checks.push(
			live.pageLikesSkipped
				? skipped("wiki.page_likes", "likes are skipped without --private-apis")
				: socialCheck(
						"wiki.page_likes",
						withoutLocal(live.pageLikes, localPages),
						withoutLocal(database.pageLikes, localPages),
					),
		);
	} else {
		checks.push(
			skipped(
				"wiki.page_likes",
				"page_likes table or its columns are not present",
			),
		);
	}

	if (tables.has("pages")) {
		const liveTree = withoutLocal(live.tree, localPages);
		const dbTree = withoutLocal(database.tree, localPages);
		const pages = unionKeys(liveTree.keys(), dbTree.keys());
		let matched = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveEntry = liveTree.get(page);
			const dbEntry = dbTree.get(page);
			if (
				liveEntry &&
				dbEntry &&
				liveEntry.parentSourceId === dbEntry.parentSourceId &&
				liveEntry.position === dbEntry.position
			) {
				matched++;
			} else {
				details.push(page);
			}
		}
		checks.push(check("confluence.page_tree", liveTree.size, matched, details));
	} else {
		checks.push(skipped("confluence.page_tree", "pages table is not present"));
	}

	return checks;
}
