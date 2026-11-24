import { bootstrapAdmin } from "./bootstrap.ts";
import { pool, runMigrations } from "./db.ts";
import { configWarnings } from "./env.ts";
import { startGitlabQueue, stopGitlabQueue } from "./gitlab/queue.ts";
import {
	createSmtpTransport,
	startMail,
	stopEmailQueue,
	stopMail,
} from "./mail.ts";
import {
	startMessengerQueue,
	stopMessengerQueue,
} from "./messenger/notices.ts";
import {
	startMessengerWorker,
	stopMessengerWorker,
} from "./messenger/worker.ts";

export async function start() {
	for (const warning of configWarnings()) console.warn(warning);
	try {
		await runMigrations();
		await bootstrapAdmin();

		const transport = createSmtpTransport();
		if (transport) {
			const started = await startMail(transport);
			if (!started) transport.close?.();
		} else {
			console.log("SMTP_URL is not set; notification email is disabled");
		}

		await startGitlabQueue();
		await startMessengerQueue();
		startMessengerWorker();
	} catch (error) {
		console.error("startup failed", error);
		await stop();
		throw error;
	}
}

export async function stop() {
	const steps: [string, () => unknown][] = [
		["messenger worker", stopMessengerWorker],
		["messenger queue", stopMessengerQueue],
		["GitLab queue", stopGitlabQueue],
		["email queue", stopEmailQueue],
		["SMTP transport", stopMail],
		["database pool", () => pool.end()],
	];
	for (const [name, step] of steps) {
		try {
			await step();
		} catch (error) {
			console.error(`shutdown: ${name} failed`, error);
		}
	}
}
