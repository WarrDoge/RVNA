import { bootstrapAdmin } from "./bootstrap.ts";
import { pool, runMigrations } from "./db.ts";
import { startGitlabQueue, stopGitlabQueue } from "./gitlab/queue.ts";
import { createSmtpTransport, startMail, stopEmailQueue } from "./mail.ts";
import {
	startMessengerQueue,
	stopMessengerQueue,
} from "./messenger/notices.ts";
import {
	startMessengerWorker,
	stopMessengerWorker,
} from "./messenger/worker.ts";

export async function start() {
	try {
		await runMigrations();
		await bootstrapAdmin();

		const transport = createSmtpTransport();
		if (transport) {
			await startMail(transport);
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
	await stopMessengerWorker();
	await stopMessengerQueue();
	await stopGitlabQueue();
	await stopEmailQueue();
	await pool.end();
}
