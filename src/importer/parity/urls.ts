import type {
	JiraAgileData,
	JiraDatabaseSnapshot,
	OldUrlResult,
	WikiDatabaseSnapshot,
} from "./types.ts";

const SAMPLE_SIZE = 20;
const MAX_BOARDS = 5;
const MAX_REDIRECTS = 10;
const REQUEST_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 120_000;

function numericId(value: string) {
	try {
		return BigInt(value);
	} catch {
		return null;
	}
}

function compareIds(left: string, right: string) {
	const leftId = numericId(left);
	const rightId = numericId(right);
	if (leftId !== null && rightId !== null) {
		return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
	}
	return left.localeCompare(right);
}

function encodeTitle(title: string) {
	if (title === "") return "-";
	return [...Buffer.from(title, "utf8")]
		.map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`)
		.join("");
}

function chooseIssueKeys(jira: JiraDatabaseSnapshot) {
	const byProject = new Map<string, string[]>();
	for (const issue of jira.issues.values()) {
		const list = byProject.get(issue.projectKey) ?? [];
		list.push(issue.key);
		byProject.set(issue.projectKey, list);
	}
	for (const [key, list] of byProject) {
		list.sort((left, right) => {
			const leftNumber = jira.issues.get(left)?.number ?? 0;
			const rightNumber = jira.issues.get(right)?.number ?? 0;
			return leftNumber - rightNumber || left.localeCompare(right);
		});
		byProject.set(key, list);
	}
	const projects = [...byProject.keys()].sort();
	const selected: string[] = [];
	const add = (key: string | undefined) => {
		if (key && !selected.includes(key) && selected.length < SAMPLE_SIZE)
			selected.push(key);
	};
	for (const project of projects) {
		const list = byProject.get(project) ?? [];
		add(list[0]);
		add(list.at(-1));
	}
	for (let offset = 1; selected.length < SAMPLE_SIZE; offset++) {
		let added = false;
		for (const project of projects) {
			const list = byProject.get(project) ?? [];
			const low = list[offset];
			const high = list[list.length - 1 - offset];
			if (low || high) added = true;
			add(low);
			add(high);
			if (selected.length >= SAMPLE_SIZE) break;
		}
		if (!added) break;
	}
	return selected;
}

function choosePageIds(wiki: WikiDatabaseSnapshot) {
	const bySpace = new Map<string, string[]>();
	for (const page of wiki.pages.values()) {
		if (page.status !== "current") continue;
		const list = bySpace.get(page.spaceKey) ?? [];
		list.push(page.sourceId);
		bySpace.set(page.spaceKey, list);
	}
	for (const list of bySpace.values()) list.sort(compareIds);
	const spaces = [...bySpace.keys()].sort();
	const selected: string[] = [];
	const add = (id: string | undefined) => {
		if (id && !selected.includes(id) && selected.length < SAMPLE_SIZE)
			selected.push(id);
	};
	for (const space of spaces) {
		const list = bySpace.get(space) ?? [];
		add(list[0]);
		add(list.at(-1));
	}
	for (let offset = 1; selected.length < SAMPLE_SIZE; offset++) {
		let added = false;
		for (const space of spaces) {
			const list = bySpace.get(space) ?? [];
			const low = list[offset];
			const high = list[list.length - 1 - offset];
			if (low || high) added = true;
			add(low);
			add(high);
			if (selected.length >= SAMPLE_SIZE) break;
		}
		if (!added) break;
	}
	return selected;
}

export function buildOldUrlPaths(
	jira: JiraDatabaseSnapshot | null,
	wiki: WikiDatabaseSnapshot | null,
	agile: JiraAgileData | null,
): OldUrlResult[] {
	const paths: string[] = [];
	if (jira) {
		for (const key of chooseIssueKeys(jira)) {
			paths.push(`/browse/${encodeURIComponent(key)}`);
		}
		const boards = (agile?.boards ?? [])
			.map((board) => board.id)
			.sort(compareIds)
			.slice(0, MAX_BOARDS);
		for (const board of boards) {
			paths.push(
				`/secure/RapidBoard.jspa?rapidView=${encodeURIComponent(board)}`,
			);
		}
	}
	if (wiki) {
		for (const pageId of choosePageIds(wiki)) {
			const page = wiki.pages.get(pageId);
			if (!page) continue;
			paths.push(`/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`);
			paths.push(
				`/display/${encodeURIComponent(page.spaceKey)}/${encodeTitle(page.title)}`,
			);
		}
	}
	return paths.map((path) => ({
		path,
		status: null,
		chain: [],
		ok: null,
	}));
}

async function mapLimit<T>(
	values: T[],
	limit: number,
	fn: (value: T, index: number) => Promise<void>,
) {
	let index = 0;
	const workers = Array.from(
		{ length: Math.min(limit, values.length) },
		async () => {
			for (;;) {
				const current = index++;
				if (current >= values.length) return;
				await fn(values[current] as T, current);
			}
		},
	);
	await Promise.all(workers);
}

async function requestOne(
	path: string,
	appUrl: string,
	appToken: string,
	fetchImpl: typeof fetch,
	counter: { count: number },
	timeoutMs: number,
): Promise<OldUrlResult> {
	const chain: number[] = [];
	try {
		const appOrigin = new URL(appUrl).origin;
		let current = new URL(path, appUrl);
		for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
			counter.count++;
			const response = await fetchImpl(current, {
				method: "GET",
				headers: {
					Accept: "text/html",
					...(current.origin === appOrigin && {
						Authorization: `Bearer ${appToken}`,
					}),
				},
				redirect: "manual",
				signal: AbortSignal.timeout(timeoutMs),
			});
			chain.push(response.status);
			await response.body?.cancel();
			if (response.status === 200) {
				return { path, status: 200, chain, ok: true };
			}
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get("location");
				if (!location) break;
				const next = new URL(location, current);
				if (next.origin !== appOrigin) break;
				current = next;
				continue;
			}
			break;
		}
		return {
			path,
			status: chain.at(-1) ?? null,
			chain,
			ok: false,
		};
	} catch (error) {
		return {
			path,
			status: chain.at(-1) ?? null,
			chain,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function requestOldUrls(
	urls: OldUrlResult[],
	appUrl: string,
	appToken: string,
	fetchImpl: typeof fetch = fetch,
	timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<{ urls: OldUrlResult[]; requests: number }> {
	const counter = { count: 0 };
	const results = [...urls];
	await mapLimit(results, REQUEST_CONCURRENCY, async (item, index) => {
		results[index] = await requestOne(
			item.path,
			appUrl,
			appToken,
			fetchImpl,
			counter,
			timeoutMs,
		);
	});
	return { urls: results, requests: counter.count };
}
