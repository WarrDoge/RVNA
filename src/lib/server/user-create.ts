import { parseArgs } from "node:util";
import { InvalidUserInput, safeMessage, saveLocalUser } from "./bootstrap.ts";
import { db, pool, runMigrations } from "./db.ts";

const usage =
	"Usage: npm run user:create -- --username <name> [--admin] [--name <full name>] [--email <address>] [--must-change] [--password-stdin]";

async function readStdin() {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

function promptHidden(question: string) {
	return new Promise<string>((resolve, reject) => {
		const input = process.stdin;
		let value = "";
		process.stderr.write(question);
		input.setRawMode(true);
		input.setEncoding("utf8");

		function finish(action: () => void) {
			input.setRawMode(false);
			input.pause();
			input.off("data", onData);
			input.off("end", onEnd);
			input.off("error", onError);
			process.stderr.write("\n");
			action();
		}
		function onData(chunk: string) {
			for (const character of chunk) {
				if (character === "\u0003") {
					return finish(() => reject(new Error("Cancelled")));
				}
				if (
					character === "\r" ||
					character === "\n" ||
					character === "\u0004"
				) {
					return finish(() => resolve(value));
				}
				if (character === "\u007f" || character === "\b") {
					value = [...value].slice(0, -1).join("");
				} else {
					value += character;
				}
			}
		}
		function onEnd() {
			finish(() =>
				reject(
					new Error("the password prompt ended before a password was entered"),
				),
			);
		}
		function onError(error: Error) {
			finish(() => reject(error));
		}
		input.on("data", onData);
		input.on("end", onEnd);
		input.on("error", onError);
		input.resume();
	});
}

async function readPassword(fromStdin: boolean) {
	if (fromStdin) {
		const password = (await readStdin()).replace(/\r?\n$/, "");
		if (!password) throw new InvalidUserInput("No password was given on stdin");
		return password;
	}
	if (!process.stdin.isTTY || !process.stderr.isTTY) {
		throw new InvalidUserInput(
			"No terminal to ask for the password: pipe it in with --password-stdin",
		);
	}
	const password = await promptHidden("Password: ");
	if ((await promptHidden("Repeat the password: ")) !== password) {
		throw new InvalidUserInput("The passwords do not match");
	}
	return password;
}

async function main() {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			username: { type: "string" },
			admin: { type: "boolean", default: false },
			name: { type: "string" },
			email: { type: "string" },
			"must-change": { type: "boolean", default: false },
			"password-stdin": { type: "boolean", default: false },
		},
	});
	if (!values.username || positionals.length > 0) {
		throw new InvalidUserInput(usage);
	}

	const password = await readPassword(values["password-stdin"]);
	await runMigrations();
	const result = await saveLocalUser(db, {
		username: values.username,
		password,
		displayName: values.name,
		email: values.email,
		admin: values.admin,
		mustChangePassword: values["must-change"],
		actorName: "cli",
	});
	console.log(`${result.action} user ${values.username}`);
	if (!result.active) {
		console.error("warning: the user is inactive and cannot log in");
	}
}

try {
	await main();
} catch (error) {
	console.error(`error: ${safeMessage(error)}`);
	process.exitCode = 1;
} finally {
	await pool.end();
}
