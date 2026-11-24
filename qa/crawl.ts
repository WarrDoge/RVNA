import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Browser,
	type BrowserContext,
	type ConsoleMessage,
	chromium,
	type Page,
	type Response as PlaywrightResponse,
	type Request,
} from "@playwright/test";
import pg from "pg";
import {
	databaseUrl,
	type ResolvedAddresses,
	resolveAddresses,
	type Screen,
} from "./addresses.ts";
import { createContext, login, VIEWPORT } from "./compare.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");
const DEFAULT_BASE = "http://127.0.0.1:5110";
const MAX_CONTROLS_PER_SCREEN = 160;
const MAX_INNER_CONTROLS = 16;
const MAX_OVERFLOW_ELEMENTS = 20;

const { Pool } = pg;

type Mode = "administrator" | "ordinary-user";

type Options = {
	base: string;
	user: string | null;
	label: string;
	only: string[] | null;
	noFlows: boolean;
	viewport: { width: number; height: number };
	flows: string[] | null;
	workers: number;
	screenTimeoutMs: number;
};

type HttpIssue = {
	method: string;
	url: string;
	status: number;
	resourceType?: string;
};

type FailedRequest = {
	method: string;
	url: string;
	resourceType: string;
	error: string;
};

type Bucket = {
	console: string[];
	page: string[];
	server: HttpIssue[];
	api4xx: HttpIssue[];
	failed: FailedRequest[];
	hydration: string[];
};

type ScreenResult = {
	id: string;
	area: Screen["area"];
	path: string;
	status: number;
	idleTimedOut: boolean;
	loadError: string | null;
	consoleErrors: string[];
	pageErrors: string[];
	serverErrors: HttpIssue[];
	api4xx: HttpIssue[];
	failedRequests: FailedRequest[];
	hydrationWarnings: string[];
	overflow: OverflowResult | null;
};

type OverflowElement = {
	role: string;
	name: string;
	width: number;
	left: number;
};

type OverflowResult = {
	documentWidth: number;
	clientWidth: number;
	elements: OverflowElement[];
};

type ControlInfo = {
	key: string;
	role: string;
	name: string;
	tag: string;
	type: string;
	href: string;
	disabled: boolean;
	inDialog: boolean;
	inPopup: boolean;
	inPostForm: boolean;
	isSubmit: boolean;
};

type DialogCheck = {
	kind: "dialog" | "menu" | "popup";
	inner: ControlResult[];
	closed: boolean;
	focusReturned: boolean;
	navigated: boolean;
	forcedClosed: boolean;
};

type ControlResult = {
	screen: string;
	role: string;
	name: string;
	tag: string;
	clicked: boolean;
	disabled: boolean;
	skipped: string | null;
	dead: boolean;
	nativeSelect: boolean;
	fileChooser: boolean;
	navigation: string | null;
	requests: number;
	domChanged: boolean;
	clickError: string | null;
	errors: Bucket;
	dialog: DialogCheck | null;
};

type BrokenLink = {
	url: string;
	pattern: string;
	status: number;
	error: string | null;
	sources: string[];
	repro: string;
};

type FlowStep = {
	name: string;
	status: "pass" | "fail";
	error: string | null;
	consoleErrors: string[];
};

type FlowResult = {
	name: string;
	status: "pass" | "fail" | "skipped";
	steps: FlowStep[];
	error: string | null;
};

type Report = {
	version: 1;
	label: string;
	mode: Mode;
	baseUrl: string;
	database: string;
	viewport: { width: number; height: number };
	generatedAt: string;
	options: { only: string[] | null; noFlows: boolean; loadOnly: boolean };
	counts: {
		screens: number;
		documentErrors: number;
		consoleErrors: number;
		pageErrors: number;
		serverErrors: number;
		api4xx: number;
		failedRequests: number;
		hydrationWarnings: number;
		brokenLinks: number;
		controls: number;
		deadControls: number;
		skippedControls: number;
		dialogProblems: number;
		flowsPassed: number;
		flowsFailed: number;
		flowsSkipped: number;
		overflowScreens: number;
		overflowElements: number;
	};
	screens: ScreenResult[];
	brokenLinks: BrokenLink[];
	controls: ControlResult[];
	flows: FlowResult[];
};

function parseOptions(): Options {
	const args = process.argv.slice(2);
	let base = process.env.QA_BASE_URL ?? DEFAULT_BASE;
	let user: string | null = null;
	let label: string | null = null;
	let only: string[] | null = null;
	let noFlows = false;
	let viewport = { ...VIEWPORT };
	let flows: string[] | null = null;
	let workers = 8;
	let screenTimeoutMs = 90_000;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const value = args[index + 1];
		if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node qa/crawl.ts [--base <url>] [--user <username>] [--label <name>] [--only <id,...>] [--no-flows] [--viewport <WxH>] [--flow <name,...>] [--workers N] [--screen-timeout seconds]",
			);
			process.exit(0);
		}
		if (arg === "--base") {
			if (!value || value.startsWith("--"))
				throw new Error("--base needs a URL");
			base = value.replace(/\/$/, "");
			index += 1;
			continue;
		}
		if (arg === "--user") {
			if (!value || value.startsWith("--"))
				throw new Error("--user needs a username");
			user = value;
			index += 1;
			continue;
		}
		if (arg === "--label") {
			if (!value || value.startsWith("--"))
				throw new Error("--label needs a name");
			if (!/^[a-z0-9-]+$/.test(value)) {
				throw new Error(
					"--label may contain only lowercase letters, digits and -",
				);
			}
			label = value;
			index += 1;
			continue;
		}
		if (arg === "--only") {
			if (!value || value.startsWith("--")) {
				throw new Error("--only needs a comma-separated list of screen ids");
			}
			only = value
				.split(",")
				.map((id) => id.trim())
				.filter(Boolean);
			if (only.length === 0) throw new Error("--only needs at least one id");
			index += 1;
			continue;
		}
		if (arg === "--no-flows") {
			noFlows = true;
			continue;
		}
		if (arg === "--viewport") {
			if (!value || !/^\d+x\d+$/.test(value)) {
				throw new Error("--viewport needs <width>x<height>");
			}
			const [width, height] = value.split("x").map(Number);
			viewport = { width: width as number, height: height as number };
			index += 1;
			continue;
		}
		if (arg === "--flow") {
			if (!value || value.startsWith("--"))
				throw new Error("--flow needs a name");
			flows = value
				.split(",")
				.map((name) => name.trim())
				.filter(Boolean);
			index += 1;
			continue;
		}
		if (arg === "--workers") {
			if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
				throw new Error("--workers needs a positive number");
			}
			workers = Math.min(16, Number(value));
			index += 1;
			continue;
		}
		if (arg === "--screen-timeout") {
			if (!value || !/^\d+$/.test(value) || Number(value) < 10) {
				throw new Error("--screen-timeout needs seconds, at least 10");
			}
			screenTimeoutMs = Number(value) * 1000;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}

	const mode: Mode = user ? "ordinary-user" : "administrator";
	const fallback = mode === "administrator" ? "admin" : (user ?? "user");
	const loadOnly = viewport.width < VIEWPORT.width;
	return {
		base,
		user,
		label: label ?? (loadOnly ? `${fallback}-${viewport.width}` : fallback),
		only,
		noFlows,
		viewport,
		flows,
		workers,
		screenTimeoutMs,
	};
}

function newBucket(): Bucket {
	return {
		console: [],
		page: [],
		server: [],
		api4xx: [],
		failed: [],
		hydration: [],
	};
}

function dedupe<T>(values: T[], key: (value: T) => string) {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const value of values) {
		const identity = key(value);
		if (seen.has(identity)) continue;
		seen.add(identity);
		out.push(value);
	}
	return out;
}

function normalize(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

class Sanitizer {
	private readonly tokenPattern: RegExp | null;

	constructor(tokens: string[]) {
		const unique = [
			...new Set(tokens.map(normalize).filter((token) => token.length >= 3)),
		]
			.sort((left, right) => right.length - left.length)
			.slice(0, 4000);
		this.tokenPattern =
			unique.length === 0
				? null
				: new RegExp(
						unique
							.map((token) => {
								const escaped = escapeRegExp(token);
								const left = /^[A-Za-z0-9]/.test(token)
									? "(?<![A-Za-z0-9])"
									: "";
								const right = /[A-Za-z0-9]$/.test(token)
									? "(?![A-Za-z0-9])"
									: "";
								return `${left}${escaped}${right}`;
							})
							.join("|"),
						"gi",
					);
	}

	text(value: string): string {
		let out = value
			.replace(/\b[A-Z][A-Z0-9_]{1,9}-\d+\b/g, "<key>")
			.replace(
				/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
				"<uuid>",
			);
		if (this.tokenPattern) out = out.replace(this.tokenPattern, "<data>");
		out = normalize(out);
		return out.length > 160 ? `${out.slice(0, 157)}...` : out;
	}

	url(value: string): string {
		try {
			const url = new URL(value);
			const segments = url.pathname.split("/").map((segment) => {
				if (segment === "") return segment;
				const decoded = decodeURIComponent(segment);
				if (
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						decoded,
					)
				) {
					return "<uuid>";
				}
				if (/^[A-Z][A-Z0-9_]{1,9}-\d+$/.test(decoded)) return "<key>";
				if (/^\d+$/.test(decoded)) return "<id>";
				if (/^[A-Z][A-Z0-9_]{1,11}$/.test(decoded)) return "<key>";
				if (decoded.length > 24 || /[\s%]/.test(decoded)) return "<data>";
				if (this.text(decoded) !== decoded) return "<data>";
				return decoded;
			});
			const params = [...url.searchParams.entries()]
				.map(([key, paramValue]) => {
					if (key === "jql") return `${key}=<jql>`;
					if (key === "queryString") return `${key}=<query>`;
					return `${key}=${paramValue === "" ? "" : "<value>"}`;
				})
				.join("&");
			return `${segments.join("/")}${params === "" ? "" : `?${params}`}`;
		} catch {
			return this.text(value);
		}
	}
}

function routePattern(value: string) {
	try {
		const url = new URL(value);
		const segments = url.pathname.split("/").map((segment) => {
			if (segment === "") return segment;
			const decoded = decodeURIComponent(segment);
			if (
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					decoded,
				)
			) {
				return "<uuid>";
			}
			if (/^[A-Z][A-Z0-9_]{1,9}-\d+$/.test(decoded)) return "<key>";
			if (/^\d+$/.test(decoded)) return "<id>";
			if (/^[A-Z][A-Z0-9_]{1,11}$/.test(decoded)) return "<key>";
			if (decoded.length > 24 || /[\s%]/.test(decoded)) return "<data>";
			return decoded;
		});
		const params = [...url.searchParams.keys()]
			.sort()
			.map((key) => `${key}=<value>`)
			.join("&");
		return `${segments.join("/")}${params === "" ? "" : `?${params}`}`;
	} catch {
		return value;
	}
}

async function loadDataTokens(databaseUrl: string) {
	const pool = new Pool({ connectionString: databaseUrl });
	const queries = [
		"select username as value from users where username is not null",
		"select display_name as value from users where display_name is not null",
		"select email as value from users where email is not null",
		"select key as value from projects",
		"select name as value from projects",
		"select key as value from issues",
		"select summary as value from issues where summary is not null",
		"select title as value from pages where status = 'current'",
		"select name as value from boards",
		"select name as value from sprints",
		"select name as value from filters",
		"select name as value from dashboards",
		"select name as value from groups",
		"select name as value from fields",
		"select name as value from priorities",
		"select name as value from statuses",
		"select name as value from resolutions",
		"select name as value from issue_types",
	];
	const values: string[] = [];
	try {
		for (const query of queries) {
			try {
				const result = await pool.query<{ value: string }>(query);
				for (const row of result.rows) {
					if (typeof row.value === "string") values.push(row.value);
				}
			} catch {
				// A table that is absent in an older copy only costs sanitising power.
			}
		}
	} finally {
		await pool.end();
	}
	return values;
}

function isApiOrAction(url: string) {
	const path = new URL(url).pathname;
	return (
		path.startsWith("/api/") || path.startsWith("/rest/") || url.includes("?/")
	);
}

function isDestructiveName(name: string) {
	return /\b(delete|remove|purge|revoke|archive|restore|discard|publish|complete sprint|start sprint|sign out|log out|reset|unlink|disconnect|clear|empty trash|bulk)\b/i.test(
		name,
	);
}

function isWriteLabel(name: string) {
	return /^(save|create|add|update|confirm|ok|yes|submit)$/i.test(name.trim());
}

function isPopupWrite(name: string) {
	return /^(link|move|insert|assign|start|finish|apply|send|comment|share|watch|unwatch|deactivate|activate)$/i.test(
		name.trim(),
	);
}

function isDestructiveUrl(value: string) {
	return /\/(logout|signout|delete|remove|purge|revoke|archive|restore|reset|unlink|disconnect|clear|trash)([!./?]|$)/i.test(
		new URL(value).pathname,
	);
}

function shouldSkip(info: ControlInfo): string | null {
	if (info.disabled) return "disabled";
	if (isDestructiveName(info.name)) return "destructive";
	if (isWriteLabel(info.name)) return "write";
	if (info.isSubmit && info.inPostForm) return "write form";
	if ((info.inDialog || info.inPopup) && isPopupWrite(info.name))
		return "write in popup";
	return null;
}

async function settle(page: Page, timeout = 15_000) {
	let idleTimedOut = false;
	await page
		.waitForLoadState("domcontentloaded", { timeout: 10_000 })
		.catch(() => {});
	await page.waitForLoadState("networkidle", { timeout }).catch(() => {
		idleTimedOut = true;
	});
	await page.evaluate(() => document.fonts.ready).catch(() => {});
	await page
		.waitForFunction(() => document.readyState === "complete", null, {
			timeout: 5_000,
		})
		.catch(() => {});
	await page.waitForTimeout(200);
	return idleTimedOut;
}

function attachCollectors(page: Page) {
	const state = {
		bucket: null as Bucket | null,
		requests: 0,
		fileChooser: false,
	};
	page.on("request", () => {
		state.requests += 1;
	});
	page.on("console", (message: ConsoleMessage) => {
		const bucket = state.bucket;
		if (!bucket) return;
		const text = normalize(message.text());
		if (message.type() === "error") bucket.console.push(text);
		if (/hydrat/i.test(text)) bucket.hydration.push(text);
	});
	page.on("pageerror", (error) => {
		const bucket = state.bucket;
		if (!bucket) return;
		bucket.page.push(normalize(error.message));
	});
	page.on("response", (response: PlaywrightResponse) => {
		const bucket = state.bucket;
		if (!bucket) return;
		const status = response.status();
		const request = response.request();
		if (status >= 500) {
			bucket.server.push({
				method: request.method(),
				url: response.url(),
				status,
				resourceType: request.resourceType(),
			});
		} else if (status >= 400 && status < 500 && isApiOrAction(response.url())) {
			bucket.api4xx.push({
				method: request.method(),
				url: response.url(),
				status,
				resourceType: request.resourceType(),
			});
		}
	});
	page.on("requestfailed", (request: Request) => {
		const bucket = state.bucket;
		if (!bucket) return;
		bucket.failed.push({
			method: request.method(),
			url: request.url(),
			resourceType: request.resourceType(),
			error: request.failure()?.errorText ?? "request failed",
		});
	});
	page.on("filechooser", (chooser) => {
		state.fileChooser = true;
		void chooser.setFiles([]).catch(() => {});
	});
	page.on("dialog", (dialog) => {
		const bucket = state.bucket;
		if (bucket) {
			bucket.console.push(`native dialog: ${dialog.type()}`);
		}
		void dialog.dismiss().catch(() => {});
	});
	return state;
}

async function collectLinks(page: Page) {
	return page.evaluate(() => {
		const out: string[] = [];
		for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
			"a[href]",
		)) {
			const href = anchor.href;
			if (!href || href.startsWith("#")) continue;
			if (/^(mailto|tel|javascript|data):/i.test(href)) continue;
			out.push(href);
		}
		return out;
	});
}

async function screenOverflow(page: Page): Promise<OverflowResult> {
	return page.evaluate((limit) => {
		const viewport = window.innerWidth;
		const doc = document.documentElement;
		const body = document.body;
		const documentWidth = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
		const clientWidth = Math.max(doc.clientWidth, body?.clientWidth ?? 0);
		const elements: {
			role: string;
			name: string;
			width: number;
			left: number;
		}[] = [];
		const seen = new Set<string>();
		if (documentWidth > clientWidth) {
			for (const element of document.querySelectorAll<HTMLElement>("body *")) {
				if (
					!element.checkVisibility({
						checkOpacity: true,
						checkVisibilityCSS: true,
					})
				) {
					continue;
				}
				const rect = element.getBoundingClientRect();
				if (rect.width <= viewport + 1 && rect.right <= viewport + 1) continue;
				const role =
					element.getAttribute("role") ?? element.tagName.toLowerCase();
				const name =
					element.getAttribute("aria-label") ??
					(element.textContent ?? "")
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 80) ??
					"";
				const key = `${role}|${name}|${Math.round(rect.width)}`;
				if (seen.has(key)) continue;
				seen.add(key);
				elements.push({
					role,
					name,
					width: Math.round(rect.width),
					left: Math.round(rect.left),
				});
				if (elements.length >= limit) break;
			}
		}
		return { documentWidth, clientWidth, elements };
	}, MAX_OVERFLOW_ELEMENTS);
}

async function loadScreen(
	page: Page,
	screen: Screen,
	collector: ReturnType<typeof attachCollectors>,
	baseUrl: string,
	loadOnly: boolean,
): Promise<ScreenResult> {
	const bucket = newBucket();
	collector.bucket = bucket;
	let response: PlaywrightResponse | null = null;
	let loadError: string | null = null;
	try {
		response = await page.goto(new URL(screen.path, baseUrl).href, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
	} catch (error) {
		loadError = errorMessage(error);
	}
	const idleTimedOut = await settle(page, 15_000);
	const overflow = loadOnly ? await screenOverflow(page) : null;
	collector.bucket = null;
	return {
		id: screen.id,
		area: screen.area,
		path: screen.path,
		status: response?.status() ?? 0,
		idleTimedOut,
		loadError,
		consoleErrors: dedupe(bucket.console, (value) => value),
		pageErrors: dedupe(bucket.page, (value) => value),
		serverErrors: dedupe(
			bucket.server,
			(value) => `${value.method} ${value.url} ${value.status}`,
		),
		api4xx: dedupe(
			bucket.api4xx,
			(value) => `${value.method} ${value.url} ${value.status}`,
		),
		failedRequests: dedupe(
			bucket.failed,
			(value) => `${value.method} ${value.url} ${value.error}`,
		),
		hydrationWarnings: dedupe(bucket.hydration, (value) => value),
		overflow,
	};
}

const CONTROL_SELECTOR =
	"button,[role=button],[role=tab],[role=menuitem],summary,select,a:not([href]),[aria-haspopup],[aria-expanded]";

async function enumerateControls(page: Page, inner = false, container = false) {
	return page.evaluate(
		({ selector, inner, container, max }) => {
			const visible = (element: HTMLElement) => {
				if (
					!element.checkVisibility({
						checkOpacity: true,
						checkVisibilityCSS: true,
					})
				) {
					return false;
				}
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0;
			};
			const labelFor = (element: HTMLElement) => {
				const labelledBy = element.getAttribute("aria-labelledby");
				if (labelledBy) {
					const text = labelledBy
						.split(/\s+/)
						.map((id) => document.getElementById(id)?.textContent ?? "")
						.join(" ");
					if (text.trim()) return text;
				}
				const aria = element.getAttribute("aria-label");
				if (aria?.trim()) return aria;
				if (element instanceof HTMLInputElement) {
					const labels = [...(element.labels ?? [])].map(
						(label) => label.textContent ?? "",
					);
					if (labels.join(" ").trim()) return labels.join(" ");
					if (element.placeholder) return element.placeholder;
					if (element.value) return element.value;
				}
				if (element instanceof HTMLSelectElement) {
					const labels = [...(element.labels ?? [])].map(
						(label) => label.textContent ?? "",
					);
					if (labels.join(" ").trim()) return labels.join(" ");
				}
				const text = element.textContent?.trim();
				if (text) return text;
				return (
					element.getAttribute("title") ?? element.getAttribute("alt") ?? ""
				);
			};
			const roleFor = (element: HTMLElement) => {
				const role = element.getAttribute("role");
				if (role) return role;
				if (element instanceof HTMLButtonElement) return "button";
				if (element instanceof HTMLSelectElement) return "combobox";
				if (element instanceof HTMLAnchorElement) return "link";
				if (element instanceof HTMLElement && element.tagName === "SUMMARY")
					return "summary";
				return element.tagName.toLowerCase();
			};
			const hash = (value: string) => {
				let result = 2166136261;
				for (let index = 0; index < value.length; index += 1) {
					result ^= value.charCodeAt(index);
					result = Math.imul(result, 16777619);
				}
				return (result >>> 0).toString(36);
			};
			const root = container
				? (document.querySelector("[data-crawl-container]") ?? document.body)
				: document.body;
			const elements: HTMLElement[] = [];
			for (const element of root.querySelectorAll<HTMLElement>(selector)) {
				if (!visible(element)) continue;
				if (element.matches("a[href]")) {
					const href =
						(element as HTMLAnchorElement).getAttribute("href") ?? "";
					if (inner && /^([a-z]+:|\/|#)/i.test(href)) {
						// Menu links are navigation; the link pass covers them.
					} else {
						continue;
					}
				}
				if (!inner) {
					const dialog = element.closest('dialog[open],[role="dialog"]');
					const popup = element.closest(
						'[role="menu"],.popover,.menu,.dropdown,.wke-menu,.fat-menu',
					);
					if (dialog || popup) continue;
				}
				elements.push(element);
			}
			const seen = new Set<string>();
			const out: {
				key: string;
				role: string;
				name: string;
				tag: string;
				type: string;
				href: string;
				disabled: boolean;
				inDialog: boolean;
				inPopup: boolean;
				inPostForm: boolean;
				isSubmit: boolean;
			}[] = [];
			for (const element of elements) {
				const role = roleFor(element);
				const rawName = labelFor(element).replace(/\s+/g, " ").trim();
				const name = rawName || role;
				const href =
					element instanceof HTMLAnchorElement
						? (element.getAttribute("href") ?? "")
						: "";
				const type = element.getAttribute("type") ?? "";
				const form = element.closest("form");
				const formMethod = (
					form?.getAttribute("method") ?? "get"
				).toLowerCase();
				const inPostForm = formMethod === "post";
				const isSubmit = type === "submit";
				const key = hash(
					[
						role,
						name,
						element.tagName,
						type,
						href,
						form?.getAttribute("action") ?? "",
					].join("|"),
				);
				if (seen.has(key)) continue;
				seen.add(key);
				element.setAttribute("data-crawl-key", key);
				out.push({
					key,
					role,
					name,
					tag: element.tagName.toLowerCase(),
					type,
					href,
					disabled:
						"disabled" in element
							? Boolean((element as HTMLButtonElement).disabled)
							: false,
					inDialog: Boolean(element.closest('dialog[open],[role="dialog"]')),
					inPopup: Boolean(
						element.closest(
							'[role="menu"],.popover,.menu,.dropdown,.wke-menu,.fat-menu',
						),
					),
					inPostForm,
					isSubmit,
				});
				if (out.length >= max) break;
			}
			return out;
		},
		{
			selector: CONTROL_SELECTOR,
			inner,
			container,
			max: MAX_CONTROLS_PER_SCREEN,
		},
	);
}

async function controlSnapshot(page: Page, key: string) {
	return page.evaluate((controlKey) => {
		const hash = (value: string) => {
			let result = 2166136261;
			for (let index = 0; index < value.length; index += 1) {
				result ^= value.charCodeAt(index);
				result = Math.imul(result, 16777619);
			}
			return (result >>> 0).toString(36);
		};
		const element = document.querySelector<HTMLElement>(
			`[data-crawl-key="${controlKey}"]`,
		);
		const active = document.activeElement as HTMLElement | null;
		const activeVisible = Boolean(
			active &&
				active !== document.body &&
				active.checkVisibility({
					checkOpacity: true,
					checkVisibilityCSS: true,
				}),
		);
		return {
			url: location.href,
			bodyHash: hash(document.body.innerHTML),
			dialogs: document.querySelectorAll('dialog[open],[role="dialog"]').length,
			menus: document.querySelectorAll('[role="menu"]').length,
			expandedCount: document.querySelectorAll('[aria-expanded="true"]').length,
			expanded: element?.getAttribute("aria-expanded") ?? null,
			pressed: element?.getAttribute("aria-pressed") ?? null,
			activeTag: active?.tagName ?? "",
			activeName:
				active?.getAttribute("aria-label") ??
				(active?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) ??
				"",
			activeVisible,
		};
	}, key);
}

async function markOpenedContainer(page: Page) {
	return page.evaluate(() => {
		const visible = (element: HTMLElement) =>
			element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
		document.querySelectorAll("[data-crawl-container]").forEach((element) => {
			element.removeAttribute("data-crawl-container");
		});
		const dialogs = [
			...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"]'),
		].filter(visible);
		const menus = [
			...document.querySelectorAll<HTMLElement>('[role="menu"]'),
		].filter(visible);
		const expanded = [
			...document.querySelectorAll<HTMLElement>('[aria-expanded="true"]'),
		].filter(visible);
		const candidate = dialogs.at(-1) ?? menus.at(-1);
		if (candidate) {
			candidate.setAttribute("data-crawl-container", "1");
			return {
				kind: dialogs.length > 0 ? "dialog" : "menu",
				dialogs: dialogs.length,
				menus: menus.length,
				expanded: expanded.length,
			};
		}
		const trigger = [...expanded]
			.reverse()
			.find(
				(element) =>
					element.hasAttribute("aria-haspopup") ||
					Boolean(
						element.parentElement?.querySelector(".popover,.menu,.dropdown"),
					),
			);
		if (!trigger) {
			return {
				kind: null,
				dialogs: dialogs.length,
				menus: menus.length,
				expanded: expanded.length,
			};
		}
		const popup = trigger.parentElement?.querySelector<HTMLElement>(
			'[role="menu"],dialog[open],[role="dialog"],.menu,.popover,.dropdown,.wke-menu',
		);
		if (popup && visible(popup)) {
			popup.setAttribute("data-crawl-container", "1");
			return {
				kind: "popup",
				dialogs: dialogs.length,
				menus: menus.length,
				expanded: expanded.length,
			};
		}
		return {
			kind: null,
			dialogs: dialogs.length,
			menus: menus.length,
			expanded: expanded.length,
		};
	});
}

async function containerOpen(page: Page) {
	return page.evaluate(() => {
		const container = document.querySelector<HTMLElement>(
			"[data-crawl-container]",
		);
		return Boolean(
			container?.checkVisibility({
				checkOpacity: true,
				checkVisibilityCSS: true,
			}),
		);
	});
}

async function closeContainer(page: Page) {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		if (!(await containerOpen(page))) return true;
		await page.keyboard.press("Escape").catch(() => {});
		await page.waitForTimeout(150);
	}
	return !(await containerOpen(page));
}

async function inspectOpened(
	page: Page,
	kind: "dialog" | "menu" | "popup",
	collector: ReturnType<typeof attachCollectors>,
	screen: string,
): Promise<DialogCheck> {
	const inner: ControlResult[] = [];
	let navigated = false;
	const controls = await enumerateControls(page, true, true);
	const ordered = [...controls].sort((left, right) => {
		const leftClose = /^(close|cancel|dismiss)$/i.test(left.name) ? 1 : 0;
		const rightClose = /^(close|cancel|dismiss)$/i.test(right.name) ? 1 : 0;
		if (leftClose !== rightClose) return leftClose - rightClose;
		const leftLink = left.href ? 1 : 0;
		const rightLink = right.href ? 1 : 0;
		return leftLink - rightLink;
	});
	for (const info of ordered.slice(0, MAX_INNER_CONTROLS)) {
		const result = await clickControl(page, info, collector, screen, true);
		inner.push(result);
		if (result.navigation) {
			navigated = true;
			break;
		}
	}
	let closed = false;
	let forcedClosed = false;
	if (!navigated) {
		closed = await closeContainer(page);
		if (!closed) {
			forcedClosed = true;
			await page.mouse.click(4, 4).catch(() => {});
			await page.waitForTimeout(150);
			closed = !(await containerOpen(page));
		}
	}
	await page
		.evaluate(() =>
			document
				.querySelector("[data-crawl-container]")
				?.removeAttribute("data-crawl-container"),
		)
		.catch(() => {});
	const focusReturned = navigated
		? true
		: await page.evaluate(() => {
				const active = document.activeElement as HTMLElement | null;
				return Boolean(
					active &&
						active !== document.body &&
						active !== document.documentElement &&
						active.checkVisibility({
							checkOpacity: true,
							checkVisibilityCSS: true,
						}),
				);
			});
	return {
		kind,
		inner,
		closed: navigated ? true : closed && !forcedClosed,
		focusReturned,
		navigated,
		forcedClosed,
	};
}

async function clickControl(
	page: Page,
	info: ControlInfo,
	collector: ReturnType<typeof attachCollectors>,
	screen: string,
	inner = false,
): Promise<ControlResult> {
	const skip = shouldSkip(info);
	const base: ControlResult = {
		screen,
		role: info.role,
		name: info.name,
		tag: info.tag,
		clicked: false,
		disabled: info.disabled,
		skipped: skip,
		dead: false,
		nativeSelect: false,
		fileChooser: false,
		navigation: null,
		requests: 0,
		domChanged: false,
		clickError: null,
		errors: newBucket(),
		dialog: null,
	};
	if (skip) return base;
	if (info.tag === "select") {
		base.clicked = true;
		base.nativeSelect = true;
		await page
			.locator(`[data-crawl-key="${info.key}"]`)
			.first()
			.click({ timeout: 3_000 })
			.catch(() => {});
		await page.keyboard.press("Escape").catch(() => {});
		return base;
	}

	const bucket = newBucket();
	collector.bucket = bucket;
	const before = await controlSnapshot(page, info.key);
	const requestBefore = collector.requests;
	const chooserBefore = collector.fileChooser;
	try {
		const locator = page.locator(`[data-crawl-key="${info.key}"]`).first();
		await locator.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
		await locator.click({ timeout: 4_000 });
		base.clicked = true;
	} catch (error) {
		base.clickError = errorMessage(error);
	}
	await page.waitForTimeout(300);
	if (collector.requests > requestBefore) {
		await page.waitForTimeout(250);
	}
	const after = await controlSnapshot(page, info.key);
	base.requests = Math.max(0, collector.requests - requestBefore);
	base.fileChooser = collector.fileChooser !== chooserBefore;
	base.domChanged = before.bodyHash !== after.bodyHash;
	base.navigation = before.url === after.url ? null : after.url;
	base.errors = bucket;
	collector.bucket = null;

	const opened = await markOpenedContainer(page);
	if (
		opened.kind &&
		(opened.dialogs > before.dialogs ||
			opened.menus > before.menus ||
			opened.expanded > before.expandedCount)
	) {
		base.dialog = await inspectOpened(
			page,
			opened.kind as "dialog" | "menu" | "popup",
			collector,
			screen,
		);
	}
	const ariaChanged =
		before.expanded !== after.expanded || before.pressed !== after.pressed;
	const focusChanged =
		before.activeTag !== after.activeTag ||
		before.activeName !== after.activeName;
	const anything =
		Boolean(base.navigation) ||
		base.requests > 0 ||
		base.domChanged ||
		ariaChanged ||
		focusChanged ||
		base.fileChooser ||
		base.clickError !== null ||
		base.dialog !== null;
	base.dead = !anything && base.clicked && !inner;
	return base;
}

async function crawlControls(
	page: Page,
	screen: Screen,
	collector: ReturnType<typeof attachCollectors>,
	baseUrl: string,
) {
	await page.goto(new URL(screen.path, baseUrl).href, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	await settle(page, 10_000);
	const processed = new Set<string>();
	const results: ControlResult[] = [];
	let reload = false;
	for (let guard = 0; guard < MAX_CONTROLS_PER_SCREEN; guard += 1) {
		if (reload) {
			await page.goto(new URL(screen.path, baseUrl).href, {
				waitUntil: "domcontentloaded",
				timeout: 60_000,
			});
			await settle(page, 8_000);
			reload = false;
		}
		const controls = await enumerateControls(page);
		const next = controls.find((control) => !processed.has(control.key));
		if (!next) break;
		processed.add(next.key);
		const started = Date.now();
		const result = await clickControl(page, next, collector, screen.id);
		if (process.env.QA_CRAWL_DEBUG) {
			console.log(
				`  ${Date.now() - started}ms ${next.role} ${next.name.slice(0, 60)}${result.dialog ? ` dialog=${result.dialog.kind} inner=${result.dialog.inner.length}` : ""}`,
			);
		}
		results.push(result);
		if (result.navigation || result.clickError) reload = true;
		if (result.dialog && (!result.dialog.closed || result.dialog.navigated))
			reload = true;
		if (result.dialog?.forcedClosed) reload = true;
	}
	return results;
}

async function checkLinks(
	context: BrowserContext,
	links: Map<string, Set<string>>,
	sanitizer: Sanitizer,
): Promise<BrokenLink[]> {
	const patterns = new Map<string, { url: string; sources: string[] }[]>();
	for (const [url, sources] of links) {
		const pattern = routePattern(url);
		const list = patterns.get(pattern) ?? [];
		if (list.length >= 3) continue;
		list.push({ url, sources: [...sources] });
		patterns.set(pattern, list);
	}
	const broken: BrokenLink[] = [];
	for (const list of patterns.values()) {
		for (const { url, sources } of list) {
			if (isDestructiveUrl(url)) continue;
			let status = 0;
			let error: string | null = null;
			try {
				let response = await context.request.fetch(url, {
					method: "HEAD",
					maxRedirects: 5,
					failOnStatusCode: false,
					timeout: 15_000,
				});
				status = response.status();
				await response.dispose();
				if (status === 405 || status === 501) {
					response = await context.request.fetch(url, {
						method: "GET",
						maxRedirects: 0,
						failOnStatusCode: false,
						timeout: 15_000,
					});
					status = response.status();
					await response.dispose();
				}
			} catch (caught) {
				error = errorMessage(caught);
			}
			if (status >= 400 || error) {
				const sourcePath = screensById.get(sources[0] ?? "")?.path ?? "/";
				broken.push({
					url: sanitizer.url(url),
					pattern: routePattern(url),
					status,
					error: error ? sanitizer.text(error) : null,
					sources,
					repro: `open ${sanitizer.url(new URL(sourcePath, "http://x").href)}; follow link ${sanitizer.url(url)}`,
				});
			}
		}
	}
	return broken;
}

let screensById = new Map<string, Screen>();

function controlRepro(path: string, result: ControlResult) {
	const action = result.skipped
		? `skip ${result.skipped}`
		: result.nativeSelect
			? "click select"
			: "click";
	return `open ${path}; ${action} ${result.role} "${result.name}"`;
}

function countControls(results: ControlResult[]) {
	let dead = 0;
	let skipped = 0;
	let dialogProblems = 0;
	for (const result of results) {
		if (result.dead) dead += 1;
		if (result.skipped) skipped += 1;
		if (
			result.dialog &&
			(!result.dialog.closed || !result.dialog.focusReturned)
		) {
			dialogProblems += 1;
		}
		for (const inner of result.dialog?.inner ?? []) {
			if (inner.dead) dead += 1;
			if (
				inner.dialog &&
				(!inner.dialog.closed || !inner.dialog.focusReturned)
			) {
				dialogProblems += 1;
			}
		}
	}
	return { dead, skipped, dialogProblems };
}

function sanitizeBucket(bucket: Bucket, sanitizer: Sanitizer): Bucket {
	return {
		console: bucket.console.map((value) => sanitizer.text(value)),
		page: bucket.page.map((value) => sanitizer.text(value)),
		server: bucket.server.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
		})),
		api4xx: bucket.api4xx.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
		})),
		failed: bucket.failed.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
			error: sanitizer.text(value.error),
		})),
		hydration: bucket.hydration.map((value) => sanitizer.text(value)),
	};
}

function sanitizeControl(
	result: ControlResult,
	sanitizer: Sanitizer,
): ControlResult {
	return {
		...result,
		name: sanitizer.text(result.name),
		errors: sanitizeBucket(result.errors, sanitizer),
		dialog: result.dialog
			? {
					...result.dialog,
					inner: result.dialog.inner.map((inner) =>
						sanitizeControl(inner, sanitizer),
					),
				}
			: null,
	};
}

function sanitizeScreen(
	screen: ScreenResult,
	sanitizer: Sanitizer,
): ScreenResult {
	return {
		...screen,
		path: sanitizer.url(new URL(screen.path, "http://x").href),
		consoleErrors: screen.consoleErrors.map((value) => sanitizer.text(value)),
		pageErrors: screen.pageErrors.map((value) => sanitizer.text(value)),
		serverErrors: screen.serverErrors.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
		})),
		api4xx: screen.api4xx.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
		})),
		failedRequests: screen.failedRequests.map((value) => ({
			...value,
			url: sanitizer.url(value.url),
			error: sanitizer.text(value.error),
		})),
		hydrationWarnings: screen.hydrationWarnings.map((value) =>
			sanitizer.text(value),
		),
		overflow: screen.overflow
			? {
					...screen.overflow,
					elements: screen.overflow.elements.map((element) => ({
						...element,
						name: sanitizer.text(element.name),
					})),
				}
			: null,
	};
}

function markdownEscape(value: string) {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdown(report: Report) {
	const sanitizedPaths = new Map(
		report.screens.map((screen) => [screen.id, screen.path]),
	);
	const lines: string[] = [];
	lines.push(`# Crawl ${report.label}`, "");
	lines.push(
		`Base: ${report.baseUrl} · Database: ${report.database} · Mode: ${report.mode} · Viewport: ${report.viewport.width}×${report.viewport.height}`,
		"",
	);
	lines.push("## Counts", "");
	lines.push("| Category | Count |");
	lines.push("| --- | ---: |");
	for (const [label, value] of [
		["Screens", report.counts.screens],
		["Document errors", report.counts.documentErrors],
		["Console errors", report.counts.consoleErrors],
		["Page errors", report.counts.pageErrors],
		["Server errors (5xx)", report.counts.serverErrors],
		["API/action 4xx", report.counts.api4xx],
		["Failed requests", report.counts.failedRequests],
		["Hydration warnings", report.counts.hydrationWarnings],
		["Broken links", report.counts.brokenLinks],
		["Controls clicked or examined", report.counts.controls],
		["Dead controls", report.counts.deadControls],
		["Controls skipped by safety", report.counts.skippedControls],
		["Dialog close/focus problems", report.counts.dialogProblems],
		["Flows passed", report.counts.flowsPassed],
		["Flows failed", report.counts.flowsFailed],
		["Flows skipped", report.counts.flowsSkipped],
		["Overflow screens", report.counts.overflowScreens],
		["Overflow elements", report.counts.overflowElements],
	] as [string, number][]) {
		lines.push(`| ${label} | ${value} |`);
	}
	lines.push("");

	const documentErrors = report.screens.filter(
		(screen) => screen.status >= 400 || screen.status === 0 || screen.loadError,
	);
	lines.push("## Document errors", "");
	if (documentErrors.length === 0) lines.push("None.");
	for (const screen of documentErrors) {
		lines.push(
			`- \`${screen.id}\` — status ${screen.status}${screen.loadError ? ` — ${markdownEscape(screen.loadError)}` : ""} — repro: open ${markdownEscape(screen.path)}`,
		);
	}
	lines.push("");

	lines.push("## Broken links", "");
	if (report.brokenLinks.length === 0) lines.push("None.");
	for (const link of report.brokenLinks) {
		lines.push(
			`- ${link.status || "error"} ${markdownEscape(link.url)} — linked from ${link.sources.map((id) => `\`${id}\``).join(", ")} — repro: ${markdownEscape(link.repro)}`,
		);
	}
	lines.push("");

	lines.push("## Console and page errors", "");
	const consoleRows = report.screens.filter(
		(screen) => screen.consoleErrors.length > 0 || screen.pageErrors.length > 0,
	);
	if (consoleRows.length === 0) lines.push("None.");
	for (const screen of consoleRows) {
		for (const message of screen.consoleErrors) {
			lines.push(`- \`${screen.id}\` console: ${markdownEscape(message)}`);
		}
		for (const message of screen.pageErrors) {
			lines.push(`- \`${screen.id}\` pageerror: ${markdownEscape(message)}`);
		}
	}
	const clickErrors = report.controls.filter(
		(control) =>
			control.errors.console.length > 0 || control.errors.page.length > 0,
	);
	for (const control of clickErrors) {
		for (const message of control.errors.console) {
			lines.push(
				`- \`${control.screen}\` ${control.role} "${markdownEscape(control.name)}" console: ${markdownEscape(message)}`,
			);
		}
		for (const message of control.errors.page) {
			lines.push(
				`- \`${control.screen}\` ${control.role} "${markdownEscape(control.name)}" pageerror: ${markdownEscape(message)}`,
			);
		}
	}
	lines.push("");

	lines.push("## Server errors and failed requests", "");
	const serverRows = report.screens.filter(
		(screen) =>
			screen.serverErrors.length > 0 ||
			screen.api4xx.length > 0 ||
			screen.failedRequests.length > 0,
	);
	if (serverRows.length === 0) lines.push("None.");
	for (const screen of serverRows) {
		for (const value of screen.serverErrors) {
			lines.push(
				`- \`${screen.id}\` ${value.status} ${value.method} ${markdownEscape(value.url)}`,
			);
		}
		for (const value of screen.api4xx) {
			lines.push(
				`- \`${screen.id}\` ${value.status} ${value.method} ${markdownEscape(value.url)}`,
			);
		}
		for (const value of screen.failedRequests) {
			lines.push(
				`- \`${screen.id}\` failed ${value.method} ${markdownEscape(value.url)} — ${markdownEscape(value.error)}`,
			);
		}
	}
	lines.push("");

	lines.push("## Hydration warnings", "");
	if (report.counts.hydrationWarnings === 0) lines.push("None.");
	for (const screen of report.screens) {
		for (const message of screen.hydrationWarnings) {
			lines.push(`- \`${screen.id}\`: ${markdownEscape(message)}`);
		}
	}
	lines.push("");

	lines.push("## Dead controls", "");
	const dead = report.controls.filter((control) => control.dead);
	if (dead.length === 0) lines.push("None.");
	for (const control of dead) {
		const path = sanitizedPaths.get(control.screen) ?? "";
		lines.push(
			`- \`${control.screen}\` ${control.role} "${markdownEscape(control.name)}" — repro: ${markdownEscape(controlRepro(path, control))}`,
		);
	}
	lines.push("");

	lines.push("## Dialogs that did not close or lost focus", "");
	const dialogProblems = report.controls.filter(
		(control) =>
			control.dialog &&
			(!control.dialog.closed || !control.dialog.focusReturned),
	);
	if (dialogProblems.length === 0) lines.push("None.");
	for (const control of dialogProblems) {
		const path = sanitizedPaths.get(control.screen) ?? "";
		const problems = [
			control.dialog?.closed ? null : "did not close",
			control.dialog?.focusReturned ? null : "focus lost",
		].filter(Boolean);
		lines.push(
			`- \`${control.screen}\` ${control.role} "${markdownEscape(control.name)}" — ${problems.join(", ")} — repro: ${markdownEscape(controlRepro(path, control))}`,
		);
	}
	lines.push("");

	lines.push("## Failed flows", "");
	const failedFlows = report.flows.filter((flow) => flow.status !== "pass");
	if (failedFlows.length === 0) lines.push("None.");
	for (const flow of failedFlows) {
		const failing = flow.steps.find((step) => step.status === "fail");
		lines.push(
			`- ${flow.name} — ${flow.status}${failing ? ` at "${failing.name}"` : ""}${flow.error ? `: ${markdownEscape(flow.error)}` : ""}`,
		);
	}
	lines.push("");

	lines.push("## Overflow", "");
	if (report.counts.overflowScreens === 0) lines.push("None.");
	for (const screen of report.screens) {
		if (!screen.overflow) continue;
		if (
			screen.overflow.documentWidth <= screen.overflow.clientWidth &&
			screen.overflow.elements.length === 0
		) {
			continue;
		}
		lines.push(
			`- \`${screen.id}\` document ${screen.overflow.documentWidth}px > viewport ${screen.overflow.clientWidth}px`,
		);
		for (const element of screen.overflow.elements) {
			lines.push(
				`  - ${element.role} "${markdownEscape(element.name)}" ${element.width}px at x=${element.left}`,
			);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

type FlowState = {
	page: Page;
	base: string;
	resolved: ResolvedAddresses;
	sanitizer: Sanitizer;
	createdIssue: string | null;
	createdBoard: number | null;
};

class FlowFailure extends Error {}

function newFlow(name: string): FlowResult {
	return { name, status: "pass", steps: [], error: null };
}

async function flowStep(
	flow: FlowResult,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
	name: string,
	action: () => Promise<void>,
) {
	const bucket = newBucket();
	collector.bucket = bucket;
	try {
		await action();
		flow.steps.push({
			name,
			status: "pass",
			error: null,
			consoleErrors: dedupe(
				[...bucket.console, ...bucket.page].map((value) =>
					sanitizer.text(value),
				),
				(value) => value,
			),
		});
	} catch (error) {
		const message = sanitizer.text(errorMessage(error));
		flow.steps.push({
			name,
			status: "fail",
			error: message,
			consoleErrors: dedupe(
				[...bucket.console, ...bucket.page].map((value) =>
					sanitizer.text(value),
				),
				(value) => value,
			),
		});
		throw new FlowFailure(message);
	} finally {
		collector.bucket = null;
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function goto(page: Page, base: string, path: string) {
	await page.goto(new URL(path, base).href, {
		waitUntil: "domcontentloaded",
		timeout: 60_000,
	});
	await settle(page, 12_000);
}

async function clickButton(page: Page, name: string, exact = true) {
	const button = page.getByRole("button", { name, exact }).first();
	await button.waitFor({ state: "visible", timeout: 10_000 });
	await button.click();
}

async function clickMenuItem(page: Page, name: string) {
	const item = page.getByRole("menuitem", { name, exact: true }).first();
	await item.waitFor({ state: "visible", timeout: 10_000 });
	await item.click();
}

async function waitForAction(
	page: Page,
	action: () => Promise<void>,
	timeout = 15_000,
) {
	const currentPath = new URL(page.url()).pathname;
	const responsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			(response.url().includes("?/") ||
				new URL(response.url()).pathname === currentPath),
		{ timeout },
	);
	await action();
	const response = await responsePromise;
	if (response.status() >= 400) {
		throw new Error(`HTTP ${response.status()} for the action`);
	}
}

async function waitForApi(
	page: Page,
	method: string,
	path: RegExp,
	action: () => Promise<void>,
	timeout = 15_000,
) {
	const responsePromise = page.waitForResponse(
		(response) =>
			response.request().method() === method &&
			path.test(new URL(response.url()).pathname),
		{ timeout },
	);
	await action();
	const response = await responsePromise;
	if (response.status() >= 400) {
		throw new Error(`HTTP ${response.status()} for ${method} ${path.source}`);
	}
	return response;
}

async function openIssue(page: Page, base: string, key: string) {
	await goto(page, base, `/browse/${encodeURIComponent(key)}`);
	await page
		.getByRole("button", { name: "Add comment", exact: true })
		.first()
		.waitFor({
			state: "visible",
			timeout: 15_000,
		});
}

async function addComment(page: Page, text: string) {
	await page
		.getByRole("button", { name: "Add comment", exact: true })
		.first()
		.click();
	const editor = page.locator(".ProseMirror:visible").last();
	await editor.waitFor({ state: "visible", timeout: 10_000 });
	await editor.click();
	await page.keyboard.type(text);
	await waitForApi(
		page,
		"POST",
		/^\/api\/issues\/[^/]+\/comments$/,
		async () => {
			await page
				.getByRole("button", { name: "Add comment", exact: true })
				.last()
				.click();
		},
	);
}

async function createIssueFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-create");
	try {
		await flowStep(
			flow,
			collector,
			sanitizer,
			"open the create dialog",
			async () => {
				await goto(state.page, state.base, "/secure/Dashboard.jspa");
				await clickButton(state.page, "Create");
				await state.page.getByRole("dialog", { name: "Create Issue" }).waitFor({
					state: "visible",
					timeout: 15_000,
				});
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"fill and submit the form",
			async () => {
				const dialog = state.page.getByRole("dialog", { name: "Create Issue" });
				const name = `CRAWL-issue-${Date.now().toString(36)}`;
				await dialog
					.getByLabel("Project", { exact: true })
					.selectOption(state.resolved.context.project);
				await state.page.waitForFunction(
					() => {
						const dialog = document.querySelector(
							'dialog[open],[role="dialog"]',
						);
						const select = dialog?.querySelector<HTMLSelectElement>(
							'select[aria-label="Issue Type"]',
						);
						return Boolean(select && select.options.length > 1);
					},
					null,
					{ timeout: 15_000 },
				);
				await dialog.getByLabel("Summary", { exact: true }).fill(name);
				await waitForApi(state.page, "POST", /^\/api\/issues$/, async () => {
					await dialog
						.getByRole("button", { name: "Create", exact: true })
						.click();
				});
				const link = state.page
					.locator('div[role="status"] a[href^="/browse/"]')
					.first();
				await link.waitFor({ state: "visible", timeout: 15_000 });
				const href = await link.getAttribute("href");
				assert(href, "the created issue link was not shown");
				state.createdIssue = href.split("/").pop() ?? null;
				assert(state.createdIssue, "the created issue key was empty");
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function editSummaryFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-edit-summary");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"open the issue and edit the summary",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				await state.page.locator("h1").first().click();
				const input = state.page.getByLabel("Summary", { exact: true });
				await input.waitFor({ state: "visible", timeout: 10_000 });
				await input.fill(`CRAWL-summary-${Date.now().toString(36)}`);
				await waitForApi(
					state.page,
					"PATCH",
					/^\/api\/issues\/[^/]+$/,
					async () => {
						await input.press("Enter");
					},
				);
				await state.page.waitForFunction(
					() => !document.querySelector('input[aria-label="Summary"]'),
					null,
					{ timeout: 10_000 },
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function commentFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-comment");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(flow, collector, sanitizer, "add a comment", async () => {
			await openIssue(state.page, state.base, state.createdIssue as string);
			const text = `CRAWL-comment-${Date.now().toString(36)}`;
			await addComment(state.page, text);
			await state.page.getByText(text, { exact: true }).first().waitFor({
				state: "visible",
				timeout: 10_000,
			});
		});
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function transitionFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-transition");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"run a workflow transition",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				const toolbar = state.page.locator(".toolbar");
				const buttons = toolbar.getByRole("button");
				const names = (await buttons.allInnerTexts()).map((value) =>
					value.replace(/\s+/g, " ").trim(),
				);
				const skip = new Set([
					"Edit",
					"Add comment",
					"Assign",
					"More",
					"Workflow",
				]);
				const index = names.findIndex((name) => name !== "" && !skip.has(name));
				assert(index >= 0, "no transition button was offered");
				const transitionName = names[index] as string;
				const responsePromise = state.page.waitForResponse(
					(response) =>
						response.request().method() === "POST" &&
						/\/api\/issues\/[^/]+\/transitions$/.test(
							new URL(response.url()).pathname,
						),
					{ timeout: 15_000 },
				);
				await buttons.nth(index).click();
				await state.page.waitForTimeout(400);
				const dialog = state.page.getByRole("dialog").first();
				if (await dialog.isVisible().catch(() => false)) {
					const select = dialog.locator("select").first();
					if (await select.count()) {
						const values = await select
							.locator("option")
							.evaluateAll((options) =>
								options
									.map((option) => (option as HTMLOptionElement).value)
									.filter(Boolean),
							);
						if (values[0]) await select.selectOption(values[0]);
					}
					await dialog
						.getByRole("button", { name: transitionName, exact: true })
						.click();
				}
				const response = await responsePromise;
				assert(
					response.status() < 400,
					`transition returned HTTP ${response.status()}`,
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function assignFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-assign");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"assign the issue to me",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				await clickButton(state.page, "Assign");
				const assignMe = state.page
					.getByRole("button", { name: "Assign to me", exact: true })
					.last();
				if (!(await assignMe.isVisible().catch(() => false))) {
					const clear = state.page.getByRole("button", {
						name: "Clear Assignee",
						exact: true,
					});
					if (await clear.isVisible().catch(() => false)) {
						await waitForApi(
							state.page,
							"PATCH",
							/^\/api\/issues\/[^/]+$/,
							async () => {
								await clear.click();
							},
						);
						await clickButton(state.page, "Assign");
					}
				}
				await waitForApi(
					state.page,
					"PATCH",
					/^\/api\/issues\/[^/]+$/,
					async () => {
						await state.page
							.getByRole("button", { name: "Assign to me", exact: true })
							.last()
							.click();
					},
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function logWorkFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-log-work");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(flow, collector, sanitizer, "log work", async () => {
			await openIssue(state.page, state.base, state.createdIssue as string);
			await clickButton(state.page, "More");
			await clickMenuItem(state.page, "Log work");
			const dialog = state.page.getByRole("dialog", { name: "Log work" });
			await dialog.getByLabel("Time spent", { exact: true }).fill("1h");
			await waitForApi(
				state.page,
				"POST",
				/^\/api\/issues\/[^/]+\/worklogs$/,
				async () => {
					await dialog
						.getByRole("button", { name: "Save", exact: true })
						.click();
				},
			);
		});
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function linkFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-link");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"link to another issue",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				await clickButton(state.page, "More");
				await clickMenuItem(state.page, "Link");
				const dialog = state.page.getByRole("dialog", { name: "Link issue" });
				await dialog
					.getByLabel("Issue key", { exact: true })
					.fill(state.resolved.context.epic);
				await waitForApi(
					state.page,
					"POST",
					/^\/api\/issues\/[^/]+\/links$/,
					async () => {
						await dialog
							.getByRole("button", { name: "Link", exact: true })
							.click();
					},
				);
				await state.page
					.getByText(state.resolved.context.epic, { exact: true })
					.first()
					.waitFor({
						state: "visible",
						timeout: 10_000,
					});
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function labelsFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-labels");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"add and remove a label",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				const openLabels = async () => {
					await state.page
						.locator("main")
						.click({ position: { x: 400, y: 300 } });
					await state.page.keyboard.press(".");
					const labelsItem = state.page
						.getByRole("menuitem", { name: /^Labels\b/ })
						.first();
					await labelsItem.waitFor({ state: "visible", timeout: 10_000 });
					await labelsItem.click();
					const dialog = state.page.getByRole("dialog", { name: "Labels" });
					await dialog.waitFor({ state: "visible", timeout: 10_000 });
					return dialog;
				};
				let dialog = await openLabels();
				await dialog.locator("#labels-input").fill("CRAWL-label");
				await waitForApi(
					state.page,
					"PATCH",
					/^\/api\/issues\/[^/]+$/,
					async () => {
						await dialog
							.getByRole("button", { name: "Save", exact: true })
							.click();
					},
				);
				dialog = await openLabels();
				await dialog.locator("#labels-input").fill("");
				await waitForApi(
					state.page,
					"PATCH",
					/^\/api\/issues\/[^/]+$/,
					async () => {
						await dialog
							.getByRole("button", { name: "Save", exact: true })
							.click();
					},
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function watchFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("issue-watch");
	try {
		assert(
			state.createdIssue,
			"the create-issue flow did not produce an issue",
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"watch and unwatch",
			async () => {
				await openIssue(state.page, state.base, state.createdIssue as string);
				const stop = state.page.getByRole("button", {
					name: "Stop watching",
					exact: true,
				});
				if (await stop.isVisible().catch(() => false)) {
					await waitForApi(
						state.page,
						"DELETE",
						/^\/api\/issues\/[^/]+\/watch$/,
						async () => {
							await stop.click();
						},
					);
				}
				const start = state.page.getByRole("button", {
					name: "Start watching",
					exact: true,
				});
				await start.waitFor({ state: "visible", timeout: 10_000 });
				await waitForApi(
					state.page,
					"PUT",
					/^\/api\/issues\/[^/]+\/watch$/,
					async () => {
						await start.click();
					},
				);
				await state.page
					.getByRole("button", { name: "Stop watching", exact: true })
					.waitFor({
						state: "visible",
						timeout: 10_000,
					});
				await waitForApi(
					state.page,
					"DELETE",
					/^\/api\/issues\/[^/]+\/watch$/,
					async () => {
						await state.page
							.getByRole("button", { name: "Stop watching", exact: true })
							.click();
					},
				);
				await state.page
					.getByRole("button", { name: "Start watching", exact: true })
					.waitFor({
						state: "visible",
						timeout: 10_000,
					});
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function filterFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("filter-save-open");
	try {
		await flowStep(
			flow,
			collector,
			sanitizer,
			"save a JQL search and open it",
			async () => {
				const jql = `project = ${state.resolved.context.project} ORDER BY key ASC`;
				await goto(
					state.page,
					state.base,
					`/issues/?jql=${encodeURIComponent(jql)}`,
				);
				await clickButton(state.page, "Save as");
				const dialog = state.page.getByRole("dialog", { name: "Save filter" });
				await dialog
					.getByLabel("Name", { exact: true })
					.fill(`CRAWL-filter-${Date.now().toString(36)}`);
				await waitForAction(state.page, async () => {
					await dialog
						.getByRole("button", { name: "Save", exact: true })
						.click();
				});
				await state.page.waitForURL(/\/issues\/\?filter=/, { timeout: 15_000 });
				assert(
					state.page.url().includes("filter="),
					"the saved filter did not open",
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function drag(
	page: Page,
	source: ReturnType<Page["locator"]>,
	target: ReturnType<Page["locator"]>,
) {
	await source.scrollIntoViewIfNeeded().catch(() => {});
	await target.scrollIntoViewIfNeeded().catch(() => {});
	try {
		await source.dragTo(target, { timeout: 5_000 });
		return;
	} catch {
		// Fall through to a pointer drag for implementations that only listen to pointer events.
	}
	const sourceBox = await source.boundingBox();
	const targetBox = await target.boundingBox();
	assert(sourceBox && targetBox, "a drag source or target had no box");
	await page.mouse.move(
		sourceBox.x + sourceBox.width / 2,
		sourceBox.y + sourceBox.height / 2,
	);
	await page.mouse.down();
	await page.mouse.move(
		targetBox.x + targetBox.width / 2,
		targetBox.y + targetBox.height / 2,
		{
			steps: 12,
		},
	);
	await page.waitForTimeout(150);
	await page.mouse.up();
}

async function boardFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("board-sprint-dnd");
	try {
		await flowStep(flow, collector, sanitizer, "create a board", async () => {
			await goto(state.page, state.base, "/secure/ManageRapidViews.jspa");
			await clickButton(state.page, "Create board");
			const dialog = state.page.getByRole("dialog", { name: "Create board" });
			await dialog
				.getByLabel("Board name", { exact: true })
				.fill(`CRAWL-board-${Date.now().toString(36)}`);
			await dialog
				.getByLabel("Board type", { exact: true })
				.selectOption("scrum");
			await dialog
				.getByLabel("Board project", { exact: true })
				.selectOption(state.resolved.context.project);
			await waitForAction(state.page, async () => {
				await dialog
					.getByRole("button", { name: "Create", exact: true })
					.click();
			});
			await state.page.waitForURL(/\/secure\/RapidBoard\.jspa\?rapidView=\d+/, {
				timeout: 15_000,
			});
			const id = new URL(state.page.url()).searchParams.get("rapidView");
			assert(id, "the new board address had no rapidView");
			state.createdBoard = Number(id);
		});
		await flowStep(flow, collector, sanitizer, "create a sprint", async () => {
			assert(state.createdBoard, "no board was created");
			const sprintName = `CRAWL-sprint-${Date.now().toString(36)}`;
			await goto(
				state.page,
				state.base,
				`/secure/RapidBoard.jspa?rapidView=${state.createdBoard}&view=planning`,
			);
			await clickButton(state.page, "Create sprint");
			const dialog = state.page.getByRole("dialog", { name: "Create sprint" });
			await dialog.getByLabel("Sprint name", { exact: true }).fill(sprintName);
			await waitForAction(state.page, async () => {
				await dialog
					.getByRole("button", { name: "Create", exact: true })
					.click();
			});
			await state.page.getByText(sprintName, { exact: true }).first().waitFor({
				state: "visible",
				timeout: 15_000,
			});
			(state as FlowState & { sprintName?: string }).sprintName = sprintName;
		});
		await flowStep(
			flow,
			collector,
			sanitizer,
			"drag an issue into the sprint",
			async () => {
				assert(state.createdBoard, "no board was created");
				const sprintName = (state as FlowState & { sprintName?: string })
					.sprintName;
				assert(sprintName, "no sprint was created");
				const row = state.page.locator("button.backlog-row").first();
				await row.waitFor({ state: "visible", timeout: 15_000 });
				const target = state.page
					.getByText(sprintName, { exact: true })
					.first()
					.locator('xpath=ancestor::div[contains(@class,"drop-zone")]');
				await waitForApi(
					state.page,
					"POST",
					new RegExp(`^/api/boards/${state.createdBoard}/move$`),
					async () => {
						await drag(state.page, row, target);
					},
				);
			},
		);
		await flowStep(flow, collector, sanitizer, "start the sprint", async () => {
			assert(state.createdBoard, "no board was created");
			await clickButton(state.page, "Start sprint");
			const dialog = state.page.getByRole("dialog", { name: "Start sprint" });
			await waitForAction(state.page, async () => {
				await dialog
					.getByRole("button", { name: "Start", exact: true })
					.click();
			});
			await state.page.getByText("Active", { exact: true }).first().waitFor({
				state: "visible",
				timeout: 15_000,
			});
		});
		await flowStep(
			flow,
			collector,
			sanitizer,
			"move a card between columns",
			async () => {
				assert(state.createdBoard, "no board was created");
				await goto(
					state.page,
					state.base,
					`/secure/RapidBoard.jspa?rapidView=${state.createdBoard}`,
				);
				const card = state.page.locator("button.board-card").first();
				await card.waitFor({ state: "visible", timeout: 15_000 });
				const columns = state.page.locator(".lane-columns > .drop-zone");
				const count = await columns.count();
				assert(count >= 2, "the board has fewer than two columns");
				const parentIndex = await card.evaluate((element) => {
					const zone = element.closest(".drop-zone");
					const all = [
						...document.querySelectorAll(".lane-columns > .drop-zone"),
					];
					return zone ? all.indexOf(zone) : -1;
				});
				const targetIndex = parentIndex === 0 ? 1 : 0;
				await waitForApi(
					state.page,
					"POST",
					new RegExp(`^/api/boards/${state.createdBoard}/move$`),
					async () => {
						await drag(state.page, card, columns.nth(targetIndex));
					},
				);
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"complete the sprint",
			async () => {
				assert(state.createdBoard, "no board was created");
				await clickButton(state.page, "Complete sprint");
				const dialog = state.page.getByRole("dialog", {
					name: "Complete sprint",
				});
				await waitForAction(state.page, async () => {
					await dialog
						.getByRole("button", { name: "Complete sprint", exact: true })
						.click();
				});
				const done = state.page.getByRole("button", {
					name: "Done",
					exact: true,
				});
				if (await done.isVisible().catch(() => false)) await done.click();
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function dashboardFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("dashboard-gadget");
	try {
		let dashboardPath = "";
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a dashboard",
			async () => {
				await goto(state.page, state.base, "/secure/Dashboard.jspa");
				await clickButton(state.page, "Dashboard actions");
				await clickMenuItem(state.page, "Create dashboard");
				const dialog = state.page.getByRole("dialog", {
					name: "Create dashboard",
				});
				await dialog
					.getByLabel("Dashboard name", { exact: true })
					.fill(`CRAWL-dashboard-${Date.now().toString(36)}`);
				await waitForAction(state.page, async () => {
					await dialog
						.getByRole("button", { name: "Create", exact: true })
						.click();
				});
				await state.page.waitForURL(/selectPageId=/, { timeout: 15_000 });
				dashboardPath = `${new URL(state.page.url()).pathname}${new URL(state.page.url()).search}`;
			},
		);
		await flowStep(flow, collector, sanitizer, "add a gadget", async () => {
			assert(dashboardPath, "no dashboard was created");
			const before = await state.page
				.getByRole("button", { name: /^Delete / })
				.count();
			await clickButton(state.page, "Add gadget");
			const dialog = state.page.getByRole("dialog", { name: "Add gadget" });
			await waitForApi(
				state.page,
				"POST",
				/^\/api\/dashboards\/[^/]+\/gadgets$/,
				async () => {
					await dialog
						.getByRole("button", { name: "Add", exact: true })
						.first()
						.click();
				},
			);
			await state.page.waitForFunction(
				(count) =>
					document.querySelectorAll('button[aria-label^="Delete "]').length >
					count,
				before,
				{ timeout: 15_000 },
			);
		});
		await flowStep(
			flow,
			collector,
			sanitizer,
			"remove the gadget",
			async () => {
				assert(dashboardPath, "no dashboard was created");
				const deletes = state.page.getByRole("button", { name: /^Delete / });
				const count = await deletes.count();
				assert(count > 0, "the added gadget had no remove control");
				await waitForApi(
					state.page,
					"DELETE",
					/^\/api\/gadgets\/[^/]+$/,
					async () => {
						await deletes.last().click();
					},
				);
				await state.page.waitForFunction(
					(expected) =>
						document.querySelectorAll('button[aria-label^="Delete "]').length <
						expected,
					count,
					{ timeout: 15_000 },
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function wikiFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("wiki-page-lifecycle");
	try {
		const title = `CRAWL-wiki-${Date.now().toString(36)}`;
		let pageId = "";
		let createdUrl = "";
		let parentTitle = "";
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a page with a heading, table and macro",
			async () => {
				const path = `/pages/createpage.action?spaceKey=${encodeURIComponent(
					state.resolved.context.wikiSpace,
				)}`;
				await goto(state.page, state.base, path);
				await state.page.getByLabel("Page title", { exact: true }).fill(title);
				const body = state.page.locator(
					'[contenteditable="true"][aria-label="Page body"]',
				);
				await body.waitFor({ state: "visible", timeout: 15_000 });
				await body.click();
				await clickButton(state.page, "Text style");
				await clickMenuItem(state.page, "Heading 1");
				await body.click();
				await state.page.keyboard.type(
					`CRAWL heading ${Date.now().toString(36)}`,
				);
				await state.page
					.getByRole("button", { name: "Insert table", exact: true })
					.click();
				await state.page
					.getByRole("button", { name: "Insert content", exact: true })
					.click();
				await clickMenuItem(state.page, "Info");
				const macro = state.page.getByRole("dialog", { name: "Insert Info" });
				await macro
					.getByRole("button", { name: "Insert", exact: true })
					.click();
				await state.page
					.getByRole("button", { name: "Publish", exact: true })
					.click();
				await state.page.waitForURL(/\/pages\/viewpage\.action\?pageId=/, {
					timeout: 20_000,
				});
				pageId = new URL(state.page.url()).searchParams.get("pageId") ?? "";
				assert(pageId, "the published page had no pageId");
				createdUrl = `${new URL(state.page.url()).pathname}${new URL(state.page.url()).search}`;
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"edit and publish the page",
			async () => {
				await state.page
					.getByRole("link", { name: "Edit", exact: true })
					.click();
				await state.page.getByLabel("Page title", { exact: true }).waitFor({
					state: "visible",
					timeout: 15_000,
				});
				const body = state.page.locator(
					'[contenteditable="true"][aria-label="Page body"]',
				);
				await body.click();
				await state.page.keyboard.press("Control+End");
				await state.page.keyboard.type(
					` CRAWL edit ${Date.now().toString(36)}`,
				);
				await state.page
					.getByRole("button", { name: "Publish", exact: true })
					.click();
				await state.page.waitForURL(/\/pages\/viewpage\.action\?pageId=/, {
					timeout: 20_000,
				});
			},
		);
		await flowStep(flow, collector, sanitizer, "add a comment", async () => {
			await clickButton(state.page, "Add a comment");
			const textarea = state.page.getByLabel("Add a comment", { exact: true });
			await textarea.fill(`CRAWL wiki comment ${Date.now().toString(36)}`);
			await waitForApi(
				state.page,
				"POST",
				/^\/api\/wiki\/pages\/[^/]+\/comments$/,
				async () => {
					await state.page
						.getByRole("button", { name: "Save", exact: true })
						.click();
				},
			);
		});
		await flowStep(
			flow,
			collector,
			sanitizer,
			"move the page under another page",
			async () => {
				assert(createdUrl, "the page was not published");
				const parentScreen = state.resolved.screens.find(
					(screen) => screen.id === "wiki-page-view",
				);
				assert(parentScreen, "no existing wiki page was resolved");
				await goto(state.page, state.base, parentScreen.path);
				parentTitle = (
					(await state.page
						.locator("h1.wiki-page-title")
						.first()
						.textContent()) ?? ""
				).trim();
				assert(parentTitle, "the target parent page had no title");
				await goto(state.page, state.base, createdUrl);
				await clickButton(state.page, "More actions");
				await clickMenuItem(state.page, "Move");
				await state.page.waitForURL(/\/pages\/movepage\.action/, {
					timeout: 15_000,
				});
				const search = state.page.getByLabel("Search for a parent page", {
					exact: true,
				});
				await search.fill(parentTitle);
				const pick = state.page.locator("button.wed-tree-pick").first();
				await pick.waitFor({ state: "visible", timeout: 10_000 });
				await pick.click();
				await waitForApi(
					state.page,
					"POST",
					/^\/api\/wiki\/pages\/[^/]+\/move$/,
					async () => {
						await state.page
							.getByRole("button", { name: "Move", exact: true })
							.click();
					},
				);
				await state.page.waitForURL(/\/pages\/viewpage\.action\?pageId=/, {
					timeout: 15_000,
				});
			},
		);
		await flowStep(flow, collector, sanitizer, "delete the page", async () => {
			await clickButton(state.page, "More actions");
			await clickMenuItem(state.page, "Delete");
			await state.page.waitForURL(/\/pages\/removepage\.action/, {
				timeout: 15_000,
			});
			await state.page
				.getByRole("button", { name: "Delete", exact: true })
				.click();
			await state.page.waitForURL(/\/pages\/viewpage\.action|\/display\//, {
				timeout: 15_000,
			});
		});
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function serviceDeskFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("service-desk-request");
	try {
		let requestPath = "";
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a request on the portal",
			async () => {
				const createScreen = state.resolved.screens.find(
					(screen) => screen.id === "portal-create",
				);
				assert(createScreen, "the portal create screen was not resolved");
				await goto(state.page, state.base, createScreen.path);
				await state.page
					.getByLabel(/^Summary/)
					.fill(`CRAWL-request-${Date.now().toString(36)}`);
				const editor = state.page.locator(".ProseMirror:visible").first();
				await editor.click();
				await state.page.keyboard.type(
					`CRAWL request body ${Date.now().toString(36)}`,
				);
				await state.page
					.getByRole("button", { name: "Send", exact: true })
					.click();
				await state.page.waitForURL(
					/\/servicedesk\/customer\/portal\/[^/]+\/[A-Z][A-Z0-9_]+-\d+/,
					{
						timeout: 20_000,
					},
				);
				requestPath = `${new URL(state.page.url()).pathname}${new URL(state.page.url()).search}`;
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"answer as the agent",
			async () => {
				assert(requestPath, "no portal request was created");
				const key = requestPath.split("/").pop();
				assert(key, "the portal request had no key");
				await openIssue(state.page, state.base, key);
				const text = `CRAWL-answer-${Date.now().toString(36)}`;
				await addComment(state.page, text);
				(state as FlowState & { answer?: string }).answer = text;
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"see the answer on the portal",
			async () => {
				const answer = (state as FlowState & { answer?: string }).answer;
				assert(requestPath && answer, "no answer was added");
				await goto(state.page, state.base, requestPath);
				await state.page.getByText(answer, { exact: true }).first().waitFor({
					state: "visible",
					timeout: 15_000,
				});
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function adminFlow(
	state: FlowState,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
) {
	const flow = newFlow("admin-crud");
	const stamp = Date.now().toString(36);
	const username = `CRAWL-user-${stamp}`;
	const groupName = `CRAWL-group-${stamp}`;
	const fieldName = `CRAWL-field-${stamp}`;
	const priorityName = `CRAWL-priority-${stamp}`;
	try {
		await flowStep(flow, collector, sanitizer, "create a user", async () => {
			await goto(state.page, state.base, "/secure/admin/user/UserBrowser.jspa");
			await clickButton(state.page, "Create user");
			const dialog = state.page.getByRole("dialog", { name: "Create user" });
			await dialog.getByLabel("Username", { exact: true }).fill(username);
			await dialog.getByLabel("Full name", { exact: true }).fill(username);
			await dialog.getByLabel("Generate a password", { exact: true }).check();
			await waitForAction(state.page, async () => {
				await dialog
					.getByRole("button", { name: "Create", exact: true })
					.click();
			});
			const done = dialog.getByRole("button", { name: "Done", exact: true });
			await done.waitFor({ state: "visible", timeout: 10_000 });
			await done.click();
		});
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a group and add the user",
			async () => {
				await goto(
					state.page,
					state.base,
					"/secure/admin/user/GroupBrowser.jspa",
				);
				await clickButton(state.page, "Add group");
				const dialog = state.page.getByRole("dialog", { name: "Add group" });
				await dialog.getByLabel("Group name", { exact: true }).fill(groupName);
				await waitForAction(state.page, async () => {
					await dialog
						.getByRole("button", { name: "Add", exact: true })
						.click();
				});
				await goto(
					state.page,
					state.base,
					`/secure/admin/user/ViewGroup.jspa?name=${encodeURIComponent(groupName)}`,
				);
				const search = state.page.getByLabel("Search users to add", {
					exact: true,
				});
				await search.fill(username);
				const add = state.page
					.getByRole("button", { name: "Add", exact: true })
					.first();
				await add.waitFor({ state: "visible", timeout: 10_000 });
				await waitForApi(
					state.page,
					"POST",
					/^\/api\/admin\/groups\/[^/]+\/members$/,
					async () => {
						await add.click();
					},
				);
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a custom field with two options",
			async () => {
				await goto(
					state.page,
					state.base,
					"/secure/admin/ViewCustomFields.jspa",
				);
				await clickButton(state.page, "Add custom field");
				const choose = state.page.getByRole("dialog", {
					name: "Add custom field",
				});
				await choose
					.getByRole("button", { name: /Select List \(single choice\)/ })
					.click();
				const form = state.page.getByRole("dialog", {
					name: "Add custom field: Select List (single choice)",
				});
				await form.getByLabel("Name", { exact: true }).fill(fieldName);
				await waitForAction(state.page, async () => {
					await form
						.getByRole("button", { name: "Create", exact: true })
						.click();
				});
				await state.page.waitForURL(/ConfigureCustomField/, {
					timeout: 15_000,
				});
				for (const option of ["CRAWL-option-a", "CRAWL-option-b"]) {
					const input = state.page.getByLabel("Add option", { exact: true });
					await input.fill(option);
					await input.press("Enter");
					await state.page.waitForFunction(
						(value) => document.body.textContent.includes(value),
						option,
						{ timeout: 10_000 },
					);
				}
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"create a priority",
			async () => {
				await goto(state.page, state.base, "/secure/admin/ViewPriorities.jspa");
				await clickButton(state.page, "Add priority");
				const dialog = state.page.getByRole("dialog", { name: "Add priority" });
				await dialog.getByLabel("Name", { exact: true }).fill(priorityName);
				await waitForAction(state.page, async () => {
					await dialog
						.getByRole("button", { name: "Add", exact: true })
						.click();
				});
				await goto(state.page, state.base, "/secure/admin/ViewPriorities.jspa");
				await state.page
					.locator(".priority-name")
					.filter({ hasText: priorityName })
					.first()
					.waitFor({ state: "visible", timeout: 10_000 });
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"delete the custom field",
			async () => {
				await goto(
					state.page,
					state.base,
					"/secure/admin/ViewCustomFields.jspa",
				);
				await state.page
					.getByLabel("Filter custom fields", { exact: true })
					.fill(fieldName);
				const row = state.page
					.getByRole("row")
					.filter({ hasText: fieldName })
					.first();
				await row.getByRole("button", { name: "Delete", exact: true }).click();
				const dialog = state.page.getByRole("dialog", {
					name: /^Delete custom field/,
				});
				await waitForApi(
					state.page,
					"POST",
					/^\/secure\/admin\/ViewCustomFields\.jspa$/,
					async () => {
						await dialog
							.getByRole("button", { name: "Delete", exact: true })
							.click();
					},
				);
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"delete the priority",
			async () => {
				await goto(state.page, state.base, "/secure/admin/ViewPriorities.jspa");
				await state.page
					.getByRole("button", { name: `Delete ${priorityName}`, exact: true })
					.click();
				const dialog = state.page.getByRole("dialog", {
					name: /^Delete priority/,
				});
				await waitForApi(
					state.page,
					"DELETE",
					/^\/api\/admin\/priorities\/[^/]+$/,
					async () => {
						await dialog
							.getByRole("button", { name: "Delete", exact: true })
							.click();
					},
				);
			},
		);
		await flowStep(
			flow,
			collector,
			sanitizer,
			"deactivate the user and delete the group",
			async () => {
				await goto(
					state.page,
					state.base,
					`/secure/admin/user/ViewUser.jspa?name=${encodeURIComponent(username)}`,
				);
				await clickButton(state.page, "Deactivate");
				const confirm = state.page.getByRole("dialog", {
					name: "Deactivate user",
				});
				await waitForApi(
					state.page,
					"POST",
					/^\/api\/admin\/users\/[^/]+\/deactivate$/,
					async () => {
						await confirm
							.getByRole("button", { name: "Deactivate", exact: true })
							.click();
					},
				);
				await goto(
					state.page,
					state.base,
					`/secure/admin/user/ViewGroup.jspa?name=${encodeURIComponent(groupName)}`,
				);
				await clickButton(state.page, "Delete group");
				const groupDialog = state.page.getByRole("dialog", {
					name: "Delete group",
				});
				await waitForApi(
					state.page,
					"DELETE",
					/^\/api\/admin\/groups\/[^/]+$/,
					async () => {
						await groupDialog
							.getByRole("button", { name: "Delete", exact: true })
							.click();
					},
				);
			},
		);
	} catch (error) {
		flow.status = "fail";
		flow.error = sanitizer.text(errorMessage(error));
	}
	return flow;
}

async function runFlows(
	page: Page,
	base: string,
	resolved: ResolvedAddresses,
	collector: ReturnType<typeof attachCollectors>,
	sanitizer: Sanitizer,
	options: Options,
) {
	const selected = options.flows ? new Set(options.flows) : null;
	const state: FlowState = {
		page,
		base,
		resolved,
		sanitizer,
		createdIssue: null,
		createdBoard: null,
	};
	const definitions: {
		name: string;
		adminOnly?: boolean;
		run: () => Promise<FlowResult>;
	}[] = [
		{
			name: "issue-create",
			run: () => createIssueFlow(state, collector, sanitizer),
		},
		{
			name: "issue-edit-summary",
			run: () => editSummaryFlow(state, collector, sanitizer),
		},
		{
			name: "issue-comment",
			run: () => commentFlow(state, collector, sanitizer),
		},
		{
			name: "issue-transition",
			run: () => transitionFlow(state, collector, sanitizer),
		},
		{
			name: "issue-assign",
			run: () => assignFlow(state, collector, sanitizer),
		},
		{
			name: "issue-log-work",
			run: () => logWorkFlow(state, collector, sanitizer),
		},
		{ name: "issue-link", run: () => linkFlow(state, collector, sanitizer) },
		{
			name: "issue-labels",
			run: () => labelsFlow(state, collector, sanitizer),
		},
		{ name: "issue-watch", run: () => watchFlow(state, collector, sanitizer) },
		{
			name: "filter-save-open",
			run: () => filterFlow(state, collector, sanitizer),
		},
		{
			name: "board-sprint-dnd",
			run: () => boardFlow(state, collector, sanitizer),
		},
		{
			name: "dashboard-gadget",
			run: () => dashboardFlow(state, collector, sanitizer),
		},
		{
			name: "wiki-page-lifecycle",
			run: () => wikiFlow(state, collector, sanitizer),
		},
		{
			name: "service-desk-request",
			run: () => serviceDeskFlow(state, collector, sanitizer),
		},
		{
			name: "admin-crud",
			adminOnly: true,
			run: () => adminFlow(state, collector, sanitizer),
		},
	];
	const flows: FlowResult[] = [];
	for (const definition of definitions) {
		if (selected && !selected.has(definition.name)) continue;
		if (definition.adminOnly && options.user) {
			flows.push({
				name: definition.name,
				status: "skipped",
				steps: [],
				error: "requires an administrator",
			});
			continue;
		}
		console.log(`flow ${definition.name}`);
		flows.push(await definition.run());
	}
	return flows;
}

type ScreenCrawl = {
	result: ScreenResult;
	controls: ControlResult[];
	links: { url: string; screen: string }[];
};

function emptyScreen(screen: Screen, error: string | null): ScreenResult {
	return {
		id: screen.id,
		area: screen.area,
		path: screen.path,
		status: 0,
		idleTimedOut: false,
		loadError: error,
		consoleErrors: [],
		pageErrors: [],
		serverErrors: [],
		api4xx: [],
		failedRequests: [],
		hydrationWarnings: [],
		overflow: null,
	};
}

async function crawlOneScreen(
	browser: Browser,
	options: Options,
	screen: Screen,
	password: string | null,
	loadOnly: boolean,
): Promise<ScreenCrawl> {
	const context = await createContext(browser, options.base);
	const page = await context.newPage();
	await page.setViewportSize(options.viewport);
	const collector = attachCollectors(page);
	try {
		await login(page, options.base, options.user, password, !options.user);
		const result = await loadScreen(
			page,
			screen,
			collector,
			options.base,
			loadOnly,
		);
		if (loadOnly) return { result, controls: [], links: [] };
		const origin = new URL(options.base).origin;
		const links: { url: string; screen: string }[] = [];
		for (const href of await collectLinks(page)) {
			const url = new URL(href);
			if (url.origin !== origin) continue;
			url.hash = "";
			links.push({ url: url.href, screen: screen.id });
		}
		let controls: ControlResult[] = [];
		const crawl = crawlControls(page, screen, collector, options.base).catch(
			(error) => {
				result.loadError = result.loadError ?? errorMessage(error);
				return [] as ControlResult[];
			},
		);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<ControlResult[]>((resolve) => {
			timer = setTimeout(() => {
				result.loadError =
					result.loadError ??
					`control crawl timed out after ${Math.round(options.screenTimeoutMs / 1000)}s`;
				resolve([]);
			}, options.screenTimeoutMs);
		});
		controls = await Promise.race([crawl, timeout]);
		if (timer) clearTimeout(timer);
		return { result, controls, links };
	} catch (error) {
		return {
			result: emptyScreen(screen, errorMessage(error)),
			controls: [],
			links: [],
		};
	} finally {
		await context.close().catch(() => {});
	}
}

async function runPool<T, R>(
	items: T[],
	workers: number,
	run: (item: T, index: number) => Promise<R>,
) {
	const results = new Array<R>(items.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(workers, items.length) }, async () => {
			while (true) {
				const index = next;
				next += 1;
				if (index >= items.length) return;
				results[index] = await run(items[index] as T, index);
			}
		}),
	);
	return results;
}

async function main() {
	const options = parseOptions();
	const resolved = await resolveAddresses();
	screensById = new Map(resolved.screens.map((screen) => [screen.id, screen]));
	let screens = resolved.screens;
	if (options.only) {
		const unknown = options.only.filter((id) => !screensById.has(id));
		if (unknown.length > 0)
			throw new Error(`unknown screen id(s): ${unknown.join(", ")}`);
		const wanted = new Set(options.only);
		screens = screens.filter((screen) => wanted.has(screen.id));
	}
	if (screens.length === 0) throw new Error("no screens selected");
	const loadOnly = options.viewport.width < VIEWPORT.width;
	const tokens = await loadDataTokens(databaseUrl());
	const sanitizer = new Sanitizer(tokens);
	const password = process.env.QA_USER_PASSWORD ?? null;
	if (options.user && !password) {
		throw new Error("--user needs QA_USER_PASSWORD");
	}

	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch({
		headless: true,
		args: ["--disable-dev-shm-usage"],
	});
	const screensReport: ScreenResult[] = [];
	const controlsReport: ControlResult[] = [];
	const flows: FlowResult[] = [];
	const links = new Map<string, Set<string>>();
	let brokenLinks: BrokenLink[] = [];
	let completed = 0;
	try {
		const crawled = await runPool(screens, options.workers, async (screen) => {
			const result = await crawlOneScreen(
				browser,
				options,
				screen,
				password,
				loadOnly,
			);
			completed += 1;
			console.log(
				`[${completed}/${screens.length}] ${screen.id} status ${result.result.status} controls ${result.controls.length}${result.result.loadError ? ` (${result.result.loadError})` : ""}`,
			);
			return result;
		});
		for (const entry of crawled) {
			screensReport.push(entry.result);
			controlsReport.push(...entry.controls);
			for (const link of entry.links) {
				const sources = links.get(link.url) ?? new Set<string>();
				sources.add(link.screen);
				links.set(link.url, sources);
			}
		}
		if (!loadOnly && !options.noFlows) {
			const flowContext = await createContext(browser, options.base);
			const flowPage = await flowContext.newPage();
			await flowPage.setViewportSize(options.viewport);
			const collector = attachCollectors(flowPage);
			try {
				await login(
					flowPage,
					options.base,
					options.user,
					password,
					!options.user,
				);
				flows.push(
					...(await runFlows(
						flowPage,
						options.base,
						resolved,
						collector,
						sanitizer,
						options,
					)),
				);
			} finally {
				await flowContext.close().catch(() => {});
			}
		}
	} catch (error) {
		console.error(errorMessage(error));
	} finally {
		await browser.close().catch(() => {});
	}

	if (!loadOnly && links.size > 0) {
		console.log(`checking ${links.size} link targets`);
		const linkBrowser = await chromium.launch({
			headless: true,
			args: ["--disable-dev-shm-usage"],
		});
		const linkContext = await createContext(linkBrowser, options.base);
		const linkPage = await linkContext.newPage();
		await linkPage.setViewportSize(options.viewport);
		try {
			await login(
				linkPage,
				options.base,
				options.user,
				password,
				!options.user,
			);
			await linkPage.close();
			brokenLinks = await checkLinks(linkContext, links, sanitizer);
		} catch (error) {
			console.error(`link check failed: ${errorMessage(error)}`);
		} finally {
			await linkContext.close().catch(() => {});
			await linkBrowser.close().catch(() => {});
		}
	}

	const controlCounts = countControls(controlsReport);
	const counts = {
		screens: screensReport.length,
		documentErrors: screensReport.filter(
			(screen) =>
				screen.status >= 400 || screen.status === 0 || screen.loadError,
		).length,
		consoleErrors: screensReport.reduce(
			(sum, screen) => sum + screen.consoleErrors.length,
			0,
		),
		pageErrors: screensReport.reduce(
			(sum, screen) => sum + screen.pageErrors.length,
			0,
		),
		serverErrors: screensReport.reduce(
			(sum, screen) => sum + screen.serverErrors.length,
			0,
		),
		api4xx: screensReport.reduce(
			(sum, screen) => sum + screen.api4xx.length,
			0,
		),
		failedRequests: screensReport.reduce(
			(sum, screen) => sum + screen.failedRequests.length,
			0,
		),
		hydrationWarnings: screensReport.reduce(
			(sum, screen) => sum + screen.hydrationWarnings.length,
			0,
		),
		brokenLinks: brokenLinks.length,
		controls: controlsReport.length,
		deadControls: controlCounts.dead,
		skippedControls: controlCounts.skipped,
		dialogProblems: controlCounts.dialogProblems,
		flowsPassed: flows.filter((flow) => flow.status === "pass").length,
		flowsFailed: flows.filter((flow) => flow.status === "fail").length,
		flowsSkipped: flows.filter((flow) => flow.status === "skipped").length,
		overflowScreens: screensReport.filter(
			(screen) =>
				screen.overflow &&
				(screen.overflow.documentWidth > screen.overflow.clientWidth ||
					screen.overflow.elements.length > 0),
		).length,
		overflowElements: screensReport.reduce(
			(sum, screen) => sum + (screen.overflow?.elements.length ?? 0),
			0,
		),
	};

	const report: Report = {
		version: 1,
		label: options.label,
		mode: options.user ? "ordinary-user" : "administrator",
		baseUrl: options.base,
		database: resolved.database,
		viewport: options.viewport,
		generatedAt: new Date().toISOString(),
		options: { only: options.only, noFlows: options.noFlows, loadOnly },
		counts,
		screens: screensReport.map((screen) => sanitizeScreen(screen, sanitizer)),
		brokenLinks,
		controls: controlsReport.map((control) =>
			sanitizeControl(control, sanitizer),
		),
		flows,
	};
	const json = `${JSON.stringify(report, null, 2)}\n`;
	const markdown = buildMarkdown(report);
	await writeFile(join(OUT_DIR, `crawl-${options.label}.json`), json);
	await writeFile(join(OUT_DIR, `crawl-${options.label}.md`), markdown);
	console.log(
		`${counts.screens} screens, ${counts.documentErrors} document errors, ${counts.brokenLinks} broken links, ${counts.deadControls} dead controls, ${counts.dialogProblems} dialog problems, ${counts.flowsFailed} failed flows`,
	);
	console.log(`Report: ${resolve(OUT_DIR, `crawl-${options.label}.md`)}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
