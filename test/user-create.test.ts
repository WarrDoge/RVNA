import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const script = fileURLToPath(
	new URL("../src/lib/server/user-create.ts", import.meta.url),
);

const fakeTty = (finish: "end" | "error") => `
import { PassThrough } from "node:stream";
const input = new PassThrough();
input.isTTY = true;
input.setRawMode = () => {};
Object.defineProperty(process, "stdin", { value: input, configurable: true });
process.stderr.isTTY = true;
process.argv = [process.argv[0], "user-create", "--username", "t-prompt-${finish}"];
setTimeout(() => {
	${finish === "end" ? "input.end();" : 'input.destroy(new Error("terminal hang-up"));'}
}, 50);
await import(process.env.USER_CREATE_PATH);
`;

async function runFakeTty(finish: "end" | "error") {
	const directory = await mkdtemp(join(tmpdir(), "rvna-prompt-"));
	const file = join(directory, "fake-tty.mjs");
	await writeFile(file, fakeTty(finish));
	try {
		return await new Promise<{ code: number | null; stderr: string }>(
			(resolve) => {
				const child = spawn(process.execPath, [file], {
					env: { ...process.env, USER_CREATE_PATH: script },
					stdio: ["ignore", "pipe", "pipe"],
				});
				let stderr = "";
				child.stderr.on("data", (chunk) => {
					stderr += chunk;
				});
				const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
				child.on("close", (code) => {
					clearTimeout(timeout);
					resolve({ code, stderr });
				});
			},
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test.each([
	["end", "error: the password prompt ended before a password was entered"],
	["error", "error: terminal hang-up"],
] as const)(
	"a password prompt that sees stdin %s restores the terminal and exits",
	async (finish, message) => {
		const result = await runFakeTty(finish);
		expect(result.code).toBe(1);
		expect(result.stderr).toContain(message);
	},
	15_000,
);
