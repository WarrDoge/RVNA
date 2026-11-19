import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type Browser,
	type BrowserContext,
	type ConsoleMessage,
	chromium,
	type Page,
	type Response as PlaywrightResponse,
	type Request,
} from "@playwright/test";
import { resolveAddresses, type Screen } from "./addresses.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");
export const VIEWPORT = { width: 1440, height: 900 };
const PIXEL_THRESHOLD = 10;
const OLD_BASE_URL = process.env.QA_OLD_URL ?? "http://127.0.0.1:5080";
const NEW_BASE_URL = process.env.QA_NEW_URL ?? "http://127.0.0.1:5081";
const MAX_CONSOLE_ERRORS = 50;

type Options = {
	only: string[] | null;
	user: string | null;
	label: string | null;
};

type Bbox = { x: number; y: number; width: number; height: number };

type ScreenshotSize = { width: number; height: number; bytes: number };

type DomSummary = {
	viewport: { width: number; height: number };
	scroll: { width: number; height: number };
	bodyText: { length: number; hash: string };
};

type ElementInfo = {
	tag: string;
	role: string | null;
	class: string;
	rect: Bbox;
	textLength: number;
	childCount: number;
	style: {
		fontSize: string;
		fontWeight: string;
		lineHeight: string;
		color: string;
		backgroundColor: string;
		display: string;
		position: string;
		overflow: string;
	};
};

type RegionInspection = {
	page: DomSummary;
	region: {
		textLength: number;
		textNodes: number;
		truncated: boolean;
	};
	text: string;
	elements: {
		smallest: ElementInfo[];
		largest: ElementInfo[];
	};
};

type Capture = {
	status: number;
	screenshot: string;
	size: ScreenshotSize;
	consoleErrors: string[];
	failedRequests: { method: string; resourceType: string; error: string }[];
	renderer: "sveltekit" | "react-fallback";
	htmlBytes: number;
	dom: DomSummary;
	idleTimedOut: boolean;
};

type DiffResult = {
	different: number;
	total: number;
	width: number;
	height: number;
	bbox: Bbox | null;
	diffDataUrl: string;
};

type ReportRow = {
	id: string;
	area: Screen["area"];
	oldStatus: number;
	newStatus: number;
	oldSize: ScreenshotSize | null;
	newSize: ScreenshotSize | null;
	diffPixels: number | null;
	totalPixels: number | null;
	diffPercent: number | null;
	diffBox: Bbox | null;
	oldConsoleErrors: string[];
	newConsoleErrors: string[];
	oldFailedRequests: number;
	newFailedRequests: number;
	newRenderer: Capture["renderer"] | "unknown";
	screenshots: { old: string | null; new: string | null; diff: string | null };
	error: string | null;
};

type DetailRow = {
	id: string;
	diffBox: Bbox | null;
	old: {
		status: number;
		renderer: Capture["renderer"] | "unknown";
		size: ScreenshotSize | null;
		dom: DomSummary | null;
		region: RegionInspection["region"] | null;
		elements: RegionInspection["elements"] | null;
		idleTimedOut: boolean;
	};
	new: {
		status: number;
		renderer: Capture["renderer"] | "unknown";
		size: ScreenshotSize | null;
		dom: DomSummary | null;
		region: RegionInspection["region"] | null;
		elements: RegionInspection["elements"] | null;
		idleTimedOut: boolean;
	};
	text: {
		oldLength: number;
		newLength: number;
		equal: boolean;
		firstDifference: number | null;
		commonPrefix: number;
	} | null;
	error: string | null;
};

type Report = {
	version: 1;
	generatedAt: string;
	mode: "administrator" | "ordinary-user";
	viewport: { width: number; height: number };
	oldBaseUrl: string;
	newBaseUrl: string;
	database: string;
	pixelThreshold: number;
	diffDefinition: string;
	summary: {
		total: number;
		identical: number;
		under0_1: number;
		under1: number;
		above1: number;
		captureErrors: number;
	};
	statusMismatches: { id: string; oldStatus: number; newStatus: number }[];
	newOnlyConsoleErrors: { id: string; errors: string[] }[];
	reactFallback: {
		id: string;
		diffPercent: number | null;
		identical: boolean;
		error: string | null;
	}[];
	rows: ReportRow[];
};

const FREEZE_CSS = `
	*, *::before, *::after {
		animation: none !important;
		transition: none !important;
		scroll-behavior: auto !important;
	}
	* {
		caret-color: transparent !important;
	}
	html, body {
		scrollbar-width: none !important;
	}
	html::-webkit-scrollbar, body::-webkit-scrollbar {
		display: none !important;
	}
`;

function parseOptions(): Options {
	const args = process.argv.slice(2);
	let only: string[] | null = null;
	let user: string | null = null;
	let label: string | null = null;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node qa/compare.ts [--only <id,...>] [--user <username>] [--label <name>]",
			);
			process.exit(0);
		}
		const value = args[index + 1];
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
		if (arg === "--user") {
			if (!value || value.startsWith("--")) {
				throw new Error("--user needs a username");
			}
			user = value;
			index += 1;
			continue;
		}
		if (arg === "--label") {
			if (!value || value.startsWith("--")) {
				throw new Error("--label needs a short name");
			}
			if (!/^[a-z0-9-]+$/.test(value)) {
				throw new Error(
					"--label may contain only lowercase letters, digits and -",
				);
			}
			label = value;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}

	return { only, user, label };
}

function pngSize(buffer: Buffer): ScreenshotSize {
	if (
		buffer.length < 24 ||
		buffer.toString("ascii", 1, 4) !== "PNG" ||
		buffer.toString("ascii", 12, 16) !== "IHDR"
	) {
		throw new Error("screenshot was not a PNG");
	}
	return {
		width: buffer.readUInt32BE(16),
		height: buffer.readUInt32BE(20),
		bytes: buffer.byteLength,
	};
}

function compareRegionText(
	oldText: string,
	newText: string,
): DetailRow["text"] {
	const common = Math.min(oldText.length, newText.length);
	let firstDifference: number | null = null;
	for (let index = 0; index < common; index += 1) {
		if (oldText[index] !== newText[index]) {
			firstDifference = index;
			break;
		}
	}
	if (firstDifference === null && oldText.length !== newText.length) {
		firstDifference = common;
	}
	return {
		oldLength: oldText.length,
		newLength: newText.length,
		equal: firstDifference === null,
		firstDifference,
		commonPrefix: firstDifference ?? common,
	};
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()))]
		.filter(Boolean)
		.slice(0, MAX_CONSOLE_ERRORS);
}

function normalizeError(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

export async function login(
	page: Page,
	baseUrl: string,
	user: string | null,
	password: string | null,
	expectAdmin: boolean,
) {
	await page.setDefaultNavigationTimeout(60_000);
	await page.setDefaultTimeout(30_000);
	if (user) {
		if (!password) {
			throw new Error(
				"--user needs QA_USER_PASSWORD; the selected local account must have a password",
			);
		}
		await page.goto(new URL("/login.jsp?local=1", baseUrl).href, {
			waitUntil: "domcontentloaded",
		});
		await page.getByLabel("Username", { exact: true }).fill(user);
		await page.getByLabel("Password", { exact: true }).fill(password);
		await Promise.all([
			page.waitForURL(/\/secure\/Dashboard\.jspa/, { timeout: 30_000 }),
			page.getByRole("button", { name: "Log in", exact: true }).click(),
		]);
	} else {
		const response = await page.goto(
			new URL("/auth/login?returnTo=/", baseUrl).href,
			{ waitUntil: "domcontentloaded" },
		);
		if (!response || response.status() >= 400) {
			throw new Error(
				`administrator sign-in failed: HTTP ${response?.status()}`,
			);
		}
	}
	await page
		.waitForLoadState("networkidle", { timeout: 30_000 })
		.catch(() => {});
	const me = await page.evaluate(async () => {
		const response = await fetch("/api/me");
		const body = (await response.json().catch(() => null)) as {
			username?: string;
			isAdmin?: boolean;
			mustChangePassword?: boolean;
		} | null;
		return { status: response.status, body };
	});
	if (me.status !== 200 || !me.body) {
		throw new Error(`could not read /api/me after sign-in: HTTP ${me.status}`);
	}
	if (me.body.mustChangePassword) {
		throw new Error(
			"the selected user must change its password before comparison",
		);
	}
	if (Boolean(me.body.isAdmin) !== expectAdmin) {
		throw new Error(
			expectAdmin
				? "administrator sign-in produced a non-administrator session"
				: "--user must select a non-administrator account",
		);
	}
}

export async function createContext(browser: Browser, baseURL: string) {
	const context = await browser.newContext({
		baseURL,
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
		colorScheme: "dark",
		reducedMotion: "reduce",
		locale: "en-US",
		timezoneId: "UTC",
		serviceWorkers: "block",
	});
	context.setDefaultTimeout(30_000);
	context.setDefaultNavigationTimeout(60_000);
	return context;
}

async function captureScreen(
	page: Page,
	baseUrl: string,
	screen: Screen,
	screenshotPath: string,
): Promise<Capture> {
	const consoleErrors: string[] = [];
	const failedRequests: Capture["failedRequests"] = [];
	const onConsole = (message: ConsoleMessage) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	};
	const onPageError = (error: Error) => {
		consoleErrors.push(`pageerror: ${error.message}`);
	};
	const onRequestFailed = (request: Request) => {
		failedRequests.push({
			method: request.method(),
			resourceType: request.resourceType(),
			error: request.failure()?.errorText ?? "request failed",
		});
	};

	page.on("console", onConsole);
	page.on("pageerror", onPageError);
	page.on("requestfailed", onRequestFailed);

	let response: PlaywrightResponse | null = null;
	let idleTimedOut = false;
	try {
		response = await page.goto(new URL(screen.path, baseUrl).href, {
			waitUntil: "domcontentloaded",
			timeout: 60_000,
		});
		await page
			.waitForLoadState("networkidle", { timeout: 20_000 })
			.catch(() => {
				idleTimedOut = true;
			});
		await page.evaluate(async () => {
			await document.fonts.ready;
		});
		await page.addStyleTag({ content: FREEZE_CSS });
		await page.evaluate(freezeRelativeTimes);
		await page.waitForTimeout(250);
		await page.evaluate(freezeRelativeTimes);
		await page.evaluate(() => window.scrollTo(0, 0));

		const html = await page.content();
		const renderer: Capture["renderer"] =
			/\/_app\/immutable\//.test(html) ||
			/__sveltekit_/.test(html) ||
			/data-sveltekit-/.test(html)
				? "sveltekit"
				: "react-fallback";
		const dom = await page.evaluate(pageDomSummary);
		const buffer = await page.screenshot({
			path: screenshotPath,
			fullPage: true,
			animations: "disabled",
			caret: "hide",
			timeout: 60_000,
		});
		return {
			status: response?.status() ?? 0,
			screenshot: screenshotPath,
			size: pngSize(buffer),
			consoleErrors: uniqueStrings(consoleErrors),
			failedRequests,
			renderer,
			htmlBytes: Buffer.byteLength(html),
			dom,
			idleTimedOut,
		};
	} finally {
		page.off("console", onConsole);
		page.off("pageerror", onPageError);
		page.off("requestfailed", onRequestFailed);
	}
}

function freezeRelativeTimes() {
	const pattern =
		/\b(?:just now|in a moment|a moment ago|a few seconds ago|less than a minute ago|in \d+ (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)|(?:\d+|an?) (?:seconds?|minutes?|hours?|days?|weeks?|months?|years?) ago)\b/gi;
	const normalized = "[relative time]";

	for (const element of document.querySelectorAll(
		"time, .relative-time, [data-relative-time]",
	)) {
		const text = element.textContent?.trim() ?? "";
		if (text !== "" && pattern.test(text)) {
			element.textContent = normalized;
			pattern.lastIndex = 0;
		}
		pattern.lastIndex = 0;
	}

	const walker = document.createTreeWalker(
		document.body ?? document.documentElement,
		NodeFilter.SHOW_TEXT,
	);
	const nodes: Text[] = [];
	while (walker.nextNode()) nodes.push(walker.currentNode as Text);
	for (const node of nodes) {
		const value = node.nodeValue ?? "";
		pattern.lastIndex = 0;
		if (!pattern.test(value)) continue;
		pattern.lastIndex = 0;
		node.nodeValue = value.replace(pattern, normalized);
	}
}

function pageDomSummary(): DomSummary {
	const root = document.documentElement;
	// biome-ignore lint/performance/useDomNodeTextContent: rendered innerText is what the visual comparison needs
	const text = document.body?.innerText ?? "";
	let hash = 2_166_136_261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		scroll: {
			width: Math.max(root.scrollWidth, root.clientWidth, window.innerWidth),
			height: Math.max(
				root.scrollHeight,
				root.clientHeight,
				window.innerHeight,
			),
		},
		bodyText: { length: text.length, hash: (hash >>> 0).toString(16) },
	};
}

async function inspectRegion(page: Page, bbox: Bbox | null) {
	return page.evaluate(
		({ box }) => {
			window.scrollTo(0, 0);
			const root = document.documentElement;
			const body = document.body;
			const page = {
				viewport: { width: window.innerWidth, height: window.innerHeight },
				scroll: {
					width: Math.max(
						root.scrollWidth,
						root.clientWidth,
						window.innerWidth,
					),
					height: Math.max(
						root.scrollHeight,
						root.clientHeight,
						window.innerHeight,
					),
				},
				bodyText: (() => {
					// biome-ignore lint/performance/useDomNodeTextContent: rendered innerText is what the visual comparison needs
					const text = body?.innerText ?? "";
					let hash = 2_166_136_261;
					for (let index = 0; index < text.length; index += 1) {
						hash ^= text.charCodeAt(index);
						hash = Math.imul(hash, 16_777_619);
					}
					return { length: text.length, hash: (hash >>> 0).toString(16) };
				})(),
			};
			const region = box ?? {
				x: 0,
				y: 0,
				width: page.scroll.width,
				height: page.scroll.height,
			};
			const intersects = (rect: {
				left: number;
				top: number;
				right: number;
				bottom: number;
			}) =>
				rect.right > region.x &&
				rect.bottom > region.y &&
				rect.left < region.x + region.width &&
				rect.top < region.y + region.height;

			const textParts: string[] = [];
			let textNodes = 0;
			let truncated = false;
			let collected = 0;
			if (body) {
				const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					const node = walker.currentNode as Text;
					const value = node.nodeValue ?? "";
					if (value.trim() === "") continue;
					const range = document.createRange();
					range.selectNodeContents(node);
					const rect = range.getBoundingClientRect();
					const left = rect.left + window.scrollX;
					const top = rect.top + window.scrollY;
					if (
						!intersects({
							left,
							top,
							right: left + rect.width,
							bottom: top + rect.height,
						})
					) {
						continue;
					}
					textNodes += 1;
					textParts.push(value);
					collected += value.length + 1;
					if (collected > 200_000) {
						truncated = true;
						break;
					}
				}
			}
			const regionText = textParts.join("\n").slice(0, 200_000);

			const candidates: {
				element: Element;
				rect: { x: number; y: number; width: number; height: number };
				area: number;
			}[] = [];
			if (body) {
				for (const element of body.querySelectorAll("*")) {
					const rect = element.getBoundingClientRect();
					const x = rect.left + window.scrollX;
					const y = rect.top + window.scrollY;
					const width = rect.width;
					const height = rect.height;
					if (width <= 0 || height <= 0) continue;
					const ix = Math.max(
						0,
						Math.min(x + width, region.x + region.width) -
							Math.max(x, region.x),
					);
					const iy = Math.max(
						0,
						Math.min(y + height, region.y + region.height) -
							Math.max(y, region.y),
					);
					if (ix <= 0 || iy <= 0) continue;
					candidates.push({
						element,
						rect: { x, y, width, height },
						area: ix * iy,
					});
					if (candidates.length >= 5_000) break;
				}
			}

			const toInfo = (candidate: (typeof candidates)[number]) => {
				const element = candidate.element;
				const style = getComputedStyle(element);
				return {
					tag: element.tagName.toLowerCase(),
					role: element.getAttribute("role"),
					class:
						typeof element.className === "string"
							? element.className.slice(0, 160)
							: (element.getAttribute("class") ?? "").slice(0, 160),
					rect: {
						x: Math.round(candidate.rect.x * 10) / 10,
						y: Math.round(candidate.rect.y * 10) / 10,
						width: Math.round(candidate.rect.width * 10) / 10,
						height: Math.round(candidate.rect.height * 10) / 10,
					},
					textLength: element.textContent?.length ?? 0,
					childCount: element.children.length,
					style: {
						fontSize: style.fontSize,
						fontWeight: style.fontWeight,
						lineHeight: style.lineHeight,
						color: style.color,
						backgroundColor: style.backgroundColor,
						display: style.display,
						position: style.position,
						overflow: style.overflow,
					},
				};
			};
			const byArea = [...candidates].sort((a, b) => a.area - b.area);
			return {
				page,
				region: {
					textLength: regionText.length,
					textNodes,
					truncated,
				},
				text: regionText,
				elements: {
					smallest: byArea.slice(0, 10).map(toInfo),
					largest: byArea.slice(-5).reverse().map(toInfo),
				},
			};
		},
		{ box: bbox },
	);
}

async function diffScreenshots(
	page: Page,
	oldPath: string,
	newPath: string,
): Promise<DiffResult> {
	const oldBuffer = await readFile(oldPath);
	const newBuffer = await readFile(newPath);
	const a = oldBuffer.toString("base64");
	const b = newBuffer.toString("base64");
	return page.evaluate(
		async ({ a, b, threshold }) => {
			const load = (source: string) =>
				new Promise<HTMLImageElement>((resolveImage, rejectImage) => {
					const image = new Image();
					image.onload = () => resolveImage(image);
					image.onerror = () => rejectImage(new Error("could not decode PNG"));
					image.src = `data:image/png;base64,${source}`;
				});
			const [oldImage, newImage] = await Promise.all([load(a), load(b)]);
			const width = Math.max(oldImage.naturalWidth, newImage.naturalWidth);
			const height = Math.max(oldImage.naturalHeight, newImage.naturalHeight);
			if (width <= 0 || height <= 0) throw new Error("empty screenshot");
			const first = document.createElement("canvas");
			first.width = width;
			first.height = height;
			const firstContext = first.getContext("2d", {
				willReadFrequently: true,
			});
			const second = document.createElement("canvas");
			second.width = width;
			second.height = height;
			const secondContext = second.getContext("2d", {
				willReadFrequently: true,
			});
			const output = document.createElement("canvas");
			output.width = width;
			output.height = height;
			const outputContext = output.getContext("2d");
			if (!firstContext || !secondContext || !outputContext) {
				throw new Error("canvas is unavailable");
			}
			firstContext.drawImage(oldImage, 0, 0);
			secondContext.drawImage(newImage, 0, 0);
			const oldPixels = firstContext.getImageData(0, 0, width, height).data;
			const newPixels = secondContext.getImageData(0, 0, width, height).data;

			outputContext.fillStyle = "#ffffff";
			outputContext.fillRect(0, 0, width, height);
			outputContext.globalAlpha = 0.28;
			outputContext.drawImage(oldImage, 0, 0);
			outputContext.drawImage(newImage, 0, 0);
			outputContext.globalAlpha = 1;
			outputContext.fillStyle = "#e11d48";

			let different = 0;
			let minX = width;
			let minY = height;
			let maxX = -1;
			let maxY = -1;
			for (let y = 0; y < height; y += 1) {
				let runStart = -1;
				for (let x = 0; x < width; x += 1) {
					const index = (y * width + x) * 4;
					const delta =
						Math.abs(oldPixels[index] - newPixels[index]) +
						Math.abs(oldPixels[index + 1] - newPixels[index + 1]) +
						Math.abs(oldPixels[index + 2] - newPixels[index + 2]) +
						Math.abs(oldPixels[index + 3] - newPixels[index + 3]);
					if (delta > threshold) {
						different += 1;
						if (runStart < 0) runStart = x;
						if (x < minX) minX = x;
						if (y < minY) minY = y;
						if (x > maxX) maxX = x;
						if (y > maxY) maxY = y;
					} else if (runStart >= 0) {
						outputContext.fillRect(runStart, y, x - runStart, 1);
						runStart = -1;
					}
				}
				if (runStart >= 0) {
					outputContext.fillRect(runStart, y, width - runStart, 1);
				}
			}

			return {
				different,
				total: width * height,
				width,
				height,
				bbox:
					different > 0
						? {
								x: minX,
								y: minY,
								width: maxX - minX + 1,
								height: maxY - minY + 1,
							}
						: null,
				diffDataUrl: output.toDataURL("image/png"),
			};
		},
		{ a, b, threshold: PIXEL_THRESHOLD },
	);
}

function percentage(different: number, total: number) {
	if (total <= 0) return 0;
	return Math.round((different / total) * 100 * 10_000) / 10_000;
}

function escapeMarkdown(value: string) {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function sizeLabel(size: ScreenshotSize | null) {
	if (!size) return "—";
	const kb = size.bytes / 1024;
	return `${size.width}×${size.height} (${kb.toFixed(1)} KB)`;
}

function bboxLabel(bbox: Bbox | null) {
	return bbox ? `${bbox.x},${bbox.y} ${bbox.width}×${bbox.height}` : "—";
}

function statusLabel(status: number) {
	return status === 0 ? "ERR" : String(status);
}

function writeMarkdownReport(report: Report) {
	const lines: string[] = [];
	lines.push("# RVNA visual comparison", "");
	lines.push(`- Generated: ${report.generatedAt}`);
	lines.push(
		`- Run: ${report.mode === "administrator" ? "administrator" : "ordinary user"}`,
	);
	lines.push(
		`- Viewport: ${report.viewport.width}×${report.viewport.height} at device scale factor 1`,
	);
	lines.push(`- OLD: ${report.oldBaseUrl}`);
	lines.push(`- NEW: ${report.newBaseUrl}`);
	lines.push(`- Database resolved by SQL: ${report.database}`);
	lines.push(
		`- A pixel differs when the sum of absolute RGBA channel differences is greater than ${report.pixelThreshold}.`,
	);
	lines.push(
		"- Diff share is over the larger screenshot canvas; pixels outside the shorter screenshot count as different.",
	);
	lines.push("- Screenshots and diff images are under `qa/out/`.", "");

	lines.push("## Summary", "");
	lines.push("| metric | count |");
	lines.push("| --- | ---: |");
	lines.push(`| addresses | ${report.summary.total} |`);
	lines.push(`| identical | ${report.summary.identical} |`);
	lines.push(`| 0 < diff < 0.1 % | ${report.summary.under0_1} |`);
	lines.push(`| 0.1 % ≤ diff < 1 % | ${report.summary.under1} |`);
	lines.push(`| diff ≥ 1 % | ${report.summary.above1} |`);
	lines.push(`| capture errors | ${report.summary.captureErrors} |`);
	lines.push("");

	lines.push("## Results", "");
	lines.push(
		"Sorted by differing pixel share, largest first. The first 30 rows are the top 30.",
		"",
	);
	lines.push(
		"| # | id | old | new | old screenshot | new screenshot | diff % | diff bbox | console old/new |",
	);
	lines.push("| ---: | --- | ---: | ---: | --- | --- | ---: | --- | ---: |");
	report.rows.forEach((row, index) => {
		lines.push(
			`| ${index + 1} | \`${row.id}\` | ${statusLabel(row.oldStatus)} | ${statusLabel(row.newStatus)} | ${sizeLabel(row.oldSize)} | ${sizeLabel(row.newSize)} | ${row.diffPercent === null ? "—" : row.diffPercent.toFixed(4)} | ${bboxLabel(row.diffBox)} | ${row.oldConsoleErrors.length}/${row.newConsoleErrors.length} |`,
		);
	});
	lines.push("");

	lines.push("## HTTP status differences", "");
	if (report.statusMismatches.length === 0) {
		lines.push("None.");
	} else {
		lines.push("| id | OLD | NEW |");
		lines.push("| --- | ---: | ---: |");
		for (const mismatch of report.statusMismatches) {
			lines.push(
				`| \`${mismatch.id}\` | ${statusLabel(mismatch.oldStatus)} | ${statusLabel(mismatch.newStatus)} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Console errors that only NEW has", "");
	if (report.newOnlyConsoleErrors.length === 0) {
		lines.push("None.");
	} else {
		for (const entry of report.newOnlyConsoleErrors) {
			lines.push(`- \`${entry.id}\``);
			for (const error of entry.errors) {
				lines.push(`  - ${escapeMarkdown(error)}`);
			}
		}
	}
	lines.push("");

	lines.push("## Screens rendered by the NEW React fallback", "");
	if (report.reactFallback.length === 0) {
		lines.push("None.");
	} else {
		lines.push(
			"These NEW page sources contain the React root and no SvelteKit app markers.",
			"",
		);
		lines.push("| id | diff % | identical |");
		lines.push("| --- | ---: | --- |");
		for (const entry of report.reactFallback) {
			lines.push(
				`| \`${entry.id}\` | ${entry.diffPercent === null ? "—" : entry.diffPercent.toFixed(4)} | ${entry.identical ? "yes" : "no"} |`,
			);
		}
	}
	lines.push("");

	lines.push("## Capture errors", "");
	const failed = report.rows.filter((row) => row.error);
	if (failed.length === 0) {
		lines.push("None.");
	} else {
		for (const row of failed) {
			lines.push(`- \`${row.id}\`: ${escapeMarkdown(row.error ?? "unknown")}`);
		}
	}
	lines.push("");
	return `${lines.join("\n")}\n`;
}

async function main() {
	const options = parseOptions();
	const password = process.env.QA_USER_PASSWORD ?? null;
	const resolved = await resolveAddresses();
	const allScreens = resolved.screens;
	let screens = allScreens;
	if (options.only) {
		const known = new Set(allScreens.map((screen) => screen.id));
		const unknown = options.only.filter((id) => !known.has(id));
		if (unknown.length > 0) {
			throw new Error(`unknown screen id(s): ${unknown.join(", ")}`);
		}
		const wanted = new Set(options.only);
		screens = allScreens.filter((screen) => wanted.has(screen.id));
	}
	if (screens.length === 0) throw new Error("no screens selected");

	await mkdir(OUT_DIR, { recursive: true });
	const browser = await chromium.launch({
		headless: true,
		args: ["--disable-dev-shm-usage"],
	});
	const rows: ReportRow[] = [];
	const details: DetailRow[] = [];
	let oldContext: BrowserContext | null = null;
	let newContext: BrowserContext | null = null;
	try {
		oldContext = await createContext(browser, OLD_BASE_URL);
		newContext = await createContext(browser, NEW_BASE_URL);
		const oldLoginPage = await oldContext.newPage();
		const newLoginPage = await newContext.newPage();
		await Promise.all([
			login(oldLoginPage, OLD_BASE_URL, options.user, password, !options.user),
			login(newLoginPage, NEW_BASE_URL, options.user, password, !options.user),
		]);
		await oldLoginPage.close();
		await newLoginPage.close();

		for (const [index, screen] of screens.entries()) {
			const prefix = `[${index + 1}/${screens.length}] ${screen.id}`;
			console.log(prefix);
			let oldPage: Page | null = null;
			let newPage: Page | null = null;
			let oldCapture: Capture | null = null;
			let newCapture: Capture | null = null;
			let diff: DiffResult | null = null;
			let oldInspection: RegionInspection | null = null;
			let newInspection: RegionInspection | null = null;
			let error: string | null = null;
			const oldName = `${screen.id}-old.png`;
			const newName = `${screen.id}-new.png`;
			const diffName = `${screen.id}-diff.png`;
			const oldPath = join(OUT_DIR, oldName);
			const newPath = join(OUT_DIR, newName);
			const diffPath = join(OUT_DIR, diffName);

			try {
				oldPage = await oldContext.newPage();
				newPage = await newContext.newPage();
				oldCapture = await captureScreen(
					oldPage,
					OLD_BASE_URL,
					screen,
					oldPath,
				);
				newCapture = await captureScreen(
					newPage,
					NEW_BASE_URL,
					screen,
					newPath,
				);
				diff = await diffScreenshots(oldPage, oldPath, newPath);
				await writeFile(
					diffPath,
					Buffer.from(diff.diffDataUrl.split(",")[1] ?? "", "base64"),
				);
				oldInspection = await inspectRegion(oldPage, diff.bbox);
				newInspection = await inspectRegion(newPage, diff.bbox);
			} catch (caught) {
				error = caught instanceof Error ? caught.message : String(caught);
				console.error(`${prefix}: ${error}`);
			} finally {
				await oldPage?.close().catch(() => {});
				await newPage?.close().catch(() => {});
			}

			const textComparison =
				oldInspection && newInspection
					? compareRegionText(oldInspection.text, newInspection.text)
					: null;
			const diffPercent =
				diff && diff.total > 0 ? percentage(diff.different, diff.total) : null;
			const row: ReportRow = {
				id: screen.id,
				area: screen.area,
				oldStatus: oldCapture?.status ?? 0,
				newStatus: newCapture?.status ?? 0,
				oldSize: oldCapture?.size ?? null,
				newSize: newCapture?.size ?? null,
				diffPixels: diff?.different ?? null,
				totalPixels: diff?.total ?? null,
				diffPercent,
				diffBox: diff?.bbox ?? null,
				oldConsoleErrors: oldCapture?.consoleErrors ?? [],
				newConsoleErrors: newCapture?.consoleErrors ?? [],
				oldFailedRequests: oldCapture?.failedRequests.length ?? 0,
				newFailedRequests: newCapture?.failedRequests.length ?? 0,
				newRenderer: newCapture?.renderer ?? "unknown",
				screenshots: {
					old: oldCapture ? oldName : null,
					new: newCapture ? newName : null,
					diff: diff ? diffName : null,
				},
				error,
			};
			rows.push(row);
			details.push({
				id: screen.id,
				diffBox: diff?.bbox ?? null,
				old: {
					status: oldCapture?.status ?? 0,
					renderer: oldCapture?.renderer ?? "unknown",
					size: oldCapture?.size ?? null,
					dom: oldCapture?.dom ?? null,
					region: oldInspection?.region ?? null,
					elements: oldInspection?.elements ?? null,
					idleTimedOut: oldCapture?.idleTimedOut ?? false,
				},
				new: {
					status: newCapture?.status ?? 0,
					renderer: newCapture?.renderer ?? "unknown",
					size: newCapture?.size ?? null,
					dom: newCapture?.dom ?? null,
					region: newInspection?.region ?? null,
					elements: newInspection?.elements ?? null,
					idleTimedOut: newCapture?.idleTimedOut ?? false,
				},
				text: textComparison,
				error,
			});
		}
	} finally {
		await oldContext?.close().catch(() => {});
		await newContext?.close().catch(() => {});
		await browser.close().catch(() => {});
	}

	rows.sort((a, b) => {
		const left = a.diffPercent ?? -1;
		const right = b.diffPercent ?? -1;
		if (right !== left) return right - left;
		const leftPixels = a.diffPixels ?? -1;
		const rightPixels = b.diffPixels ?? -1;
		if (rightPixels !== leftPixels) return rightPixels - leftPixels;
		return a.id.localeCompare(b.id);
	});

	const summary = {
		total: rows.length,
		identical: rows.filter((row) => row.diffPixels === 0).length,
		under0_1: rows.filter(
			(row) =>
				row.diffPercent !== null &&
				row.diffPercent > 0 &&
				row.diffPercent < 0.1,
		).length,
		under1: rows.filter(
			(row) =>
				row.diffPercent !== null &&
				row.diffPercent >= 0.1 &&
				row.diffPercent < 1,
		).length,
		above1: rows.filter(
			(row) => row.diffPercent !== null && row.diffPercent >= 1,
		).length,
		captureErrors: rows.filter((row) => row.error).length,
	};

	const statusMismatches = rows
		.filter((row) => row.oldStatus !== row.newStatus)
		.map((row) => ({
			id: row.id,
			oldStatus: row.oldStatus,
			newStatus: row.newStatus,
		}));
	const newOnlyConsoleErrors = rows
		.map((row) => {
			const oldErrors = new Set(row.oldConsoleErrors.map(normalizeError));
			const errors = row.newConsoleErrors.filter(
				(errorText) => !oldErrors.has(normalizeError(errorText)),
			);
			return { id: row.id, errors: uniqueStrings(errors) };
		})
		.filter((entry) => entry.errors.length > 0);
	const reactFallback = rows
		.filter((row) => row.newRenderer === "react-fallback")
		.map((row) => ({
			id: row.id,
			diffPercent: row.diffPercent,
			identical: row.diffPixels === 0,
			error: row.error,
		}));

	const report: Report = {
		version: 1,
		generatedAt: new Date().toISOString(),
		mode: options.user ? "ordinary-user" : "administrator",
		viewport: VIEWPORT,
		oldBaseUrl: OLD_BASE_URL,
		newBaseUrl: NEW_BASE_URL,
		database: resolved.database,
		pixelThreshold: PIXEL_THRESHOLD,
		diffDefinition:
			"Pixels differ when the sum of absolute RGBA channel differences is greater than the threshold. Diff share uses the larger screenshot canvas; missing pixels count as different.",
		summary,
		statusMismatches,
		newOnlyConsoleErrors,
		reactFallback,
		rows,
	};

	const suffix = options.label ? `-${options.label}` : "";
	const reportJson = `${JSON.stringify(report, null, 2)}\n`;
	const detailsJson = `${JSON.stringify(
		{
			generatedAt: report.generatedAt,
			mode: report.mode,
			viewport: report.viewport,
			rows: details,
		},
		null,
		2,
	)}\n`;
	const reportMarkdown = writeMarkdownReport(report);
	await writeFile(join(OUT_DIR, "report.json"), reportJson);
	await writeFile(join(OUT_DIR, "report.md"), reportMarkdown);
	await writeFile(join(OUT_DIR, "details.json"), detailsJson);
	if (suffix) {
		await writeFile(join(OUT_DIR, `report${suffix}.json`), reportJson);
		await writeFile(join(OUT_DIR, `report${suffix}.md`), reportMarkdown);
		await writeFile(join(OUT_DIR, `details${suffix}.json`), detailsJson);
	}

	console.log("");
	console.log(
		`${summary.total} screens: ${summary.identical} identical, ${summary.under0_1} <0.1%, ${summary.under1} <1%, ${summary.above1} >=1%, ${summary.captureErrors} errors`,
	);
	console.log(`Report: ${resolve(OUT_DIR, "report.md")}`);
	if (summary.captureErrors > 0) process.exitCode = 1;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
