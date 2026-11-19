import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const outputs = ["build/index.js", "build/server/manifest.js"];
const inputs = [
	"src",
	"test",
	"vite.config.ts",
	"tsconfig.json",
	"package.json",
	"package-lock.json",
];

function newest(path: string): number {
	const stats = statSync(path);
	if (!stats.isDirectory()) return stats.mtimeMs;
	let value = stats.mtimeMs;
	for (const entry of readdirSync(path)) {
		value = Math.max(value, newest(join(path, entry)));
	}
	return value;
}

// `npm run check` only needs build/ to exist: test/server.ts imports it.
if (process.argv.includes("--if-missing") && outputs.every(existsSync)) {
	process.exit(0);
}

const outputTime = outputs.every(existsSync)
	? Math.min(...outputs.map((path) => statSync(path).mtimeMs))
	: 0;
const inputTime = Math.max(...inputs.filter(existsSync).map(newest));

if (outputTime < inputTime) {
	execFileSync("npm", ["run", "build"], { stdio: "inherit" });
}
