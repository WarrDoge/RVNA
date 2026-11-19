import {
	check,
	compareSets,
	skipped,
	sorted,
	symmetricDifference,
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

	if (tables.has("page_versions")) {
		const pages = unionKeys(
			withoutLocal(live.versions, localPages).keys(),
			withoutLocal(database.versions, localPages).keys(),
		);
		let liveTotal = 0;
		let dbTotal = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveCount = withoutLocal(live.versions, localPages).get(page) ?? 0;
			const dbCount =
				withoutLocal(database.versions, localPages).get(page) ?? 0;
			liveTotal += liveCount;
			dbTotal += dbCount;
			if (liveCount !== dbCount) details.push(page);
		}
		checks.push(check("confluence.versions", liveTotal, dbTotal, details));
	} else {
		checks.push(
			skipped("confluence.versions", "page_versions table is not present"),
		);
	}

	if (tables.has("page_comments")) {
		for (const kind of ["page", "inline"] as const) {
			const pages = unionKeys(
				withoutLocal(live.comments, localPages).keys(),
				withoutLocal(database.comments, localPages).keys(),
			);
			let liveTotal = 0;
			let dbTotal = 0;
			const details: string[] = [];
			for (const page of pages) {
				const liveCount =
					withoutLocal(live.comments, localPages).get(page)?.[kind] ?? 0;
				const dbCount =
					withoutLocal(database.comments, localPages).get(page)?.[kind] ?? 0;
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
			skipped("confluence.comments", "page_comments table is not present"),
		);
	}

	if (tables.has("page_attachments")) {
		const pages = unionKeys(
			withoutLocal(live.attachments, localPages).keys(),
			withoutLocal(database.attachments, localPages).keys(),
		);
		let liveTotal = 0;
		let dbTotal = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveIds = new Set(
				(withoutLocal(live.attachments, localPages).get(page) ?? []).map(
					(item) => item.sourceId,
				),
			);
			const dbIds = new Set(
				(withoutLocal(database.attachments, localPages).get(page) ?? []).map(
					(item) => item.sourceId,
				),
			);
			liveTotal += liveIds.size;
			dbTotal += dbIds.size;
			details.push(...symmetricDifference(liveIds, dbIds));
		}
		checks.push(check("confluence.attachments", liveTotal, dbTotal, details));

		const dbSample = new Map<string, { size: number; sha256: string }>();
		for (const items of withoutLocal(
			database.attachments,
			localPages,
		).values()) {
			for (const item of items) {
				dbSample.set(item.sourceId, {
					size: item.size,
					sha256: item.sha256,
				});
			}
		}
		const sampleDetails: string[] = [];
		const sizeDetails: string[] = [];
		let sampleMatches = 0;
		let liveBytes = 0;
		let dbBytes = 0;
		for (const item of live.attachmentSample) {
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
				live.attachmentSample.length,
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
				"page_attachments table is not present",
			),
			skipped(
				"confluence.attachments.sample",
				"page_attachments table is not present",
			),
			skipped(
				"confluence.attachments.sample_bytes",
				"page_attachments table is not present",
			),
		);
	}

	if (tables.has("page_labels")) {
		const liveLabels = new Map(
			[...livePages.entries()].map(([key, page]) => [key, page.labels]),
		);
		const pages = unionKeys(
			liveLabels.keys(),
			withoutLocal(database.labels, localPages).keys(),
		);
		const details: string[] = [];
		let liveTotal = 0;
		let dbTotal = 0;
		for (const page of pages) {
			const liveValues = new Set(liveLabels.get(page) ?? []);
			const dbValues = new Set(
				withoutLocal(database.labels, localPages).get(page) ?? [],
			);
			liveTotal += liveValues.size;
			dbTotal += dbValues.size;
			if (symmetricDifference(liveValues, dbValues).length > 0) {
				details.push(page);
			}
		}
		checks.push(check("confluence.labels", liveTotal, dbTotal, details));
	} else {
		checks.push(
			skipped("confluence.labels", "page_labels table is not present"),
		);
	}

	if (tables.has("page_restrictions")) {
		const liveRestrictions = new Map(
			[...livePages.entries()].map(([key, page]) => [key, page.restrictions]),
		);
		const pages = unionKeys(
			liveRestrictions.keys(),
			database.restrictions.keys(),
		);
		const details: string[] = [];
		let liveTotal = 0;
		let dbTotal = 0;
		for (const page of pages) {
			const liveValues = new Set(liveRestrictions.get(page) ?? []);
			const dbValues = new Set(
				withoutLocal(database.restrictions, localPages).get(page) ?? [],
			);
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
				"page_restrictions table is not present",
			),
		);
	}

	if (tables.has("space_permissions")) {
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
				"space_permissions table is not present",
			),
		);
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

	if (
		tables.has("page_watchers") &&
		tables.hasColumns("page_watchers", ["source_id"])
	) {
		checks.push(
			live.watchersSkipped
				? skipped(
						"wiki.page_watchers",
						"watchers are skipped without --private-apis",
					)
				: socialCheck(
						"wiki.page_watchers",
						live.pageWatchers,
						database.pageWatchers,
					),
		);
	} else {
		checks.push(
			skipped("wiki.page_watchers", "page_watchers.source_id is not present"),
		);
	}

	if (
		tables.has("space_watchers") &&
		tables.hasColumns("space_watchers", ["source_id"])
	) {
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
			skipped("wiki.space_watchers", "space_watchers.source_id is not present"),
		);
	}

	if (
		tables.has("page_likes") &&
		tables.hasColumns("page_likes", ["source_id"])
	) {
		checks.push(
			live.pageLikesSkipped
				? skipped("wiki.page_likes", "likes are skipped without --private-apis")
				: socialCheck("wiki.page_likes", live.pageLikes, database.pageLikes),
		);
	} else {
		checks.push(
			skipped("wiki.page_likes", "page_likes.source_id is not present"),
		);
	}

	if (tables.has("pages")) {
		const pages = unionKeys(
			withoutLocal(live.tree, localPages).keys(),
			withoutLocal(database.tree, localPages).keys(),
		);
		let matched = 0;
		const details: string[] = [];
		for (const page of pages) {
			const liveTree = withoutLocal(live.tree, localPages).get(page);
			const dbTree = withoutLocal(database.tree, localPages).get(page);
			if (
				liveTree &&
				dbTree &&
				liveTree.parentSourceId === dbTree.parentSourceId &&
				liveTree.position === dbTree.position
			) {
				matched++;
			} else {
				details.push(page);
			}
		}
		checks.push(check("confluence.page_tree", pages.length, matched, details));
	} else {
		checks.push(skipped("confluence.page_tree", "pages table is not present"));
	}

	return checks;
}
