import type { Job, PgBoss } from "pg-boss";
import { getBoss, stopBoss } from "../boss.ts";
import { processGitlabDelivery } from "./events.ts";

export const GITLAB_QUEUE = "gitlab-webhook";

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function start() {
	const instance = await getBoss();
	await instance.createQueue(GITLAB_QUEUE, {
		retryLimit: 5,
		retryDelay: 5,
		retryBackoff: true,
		expireInSeconds: 300,
	});
	await instance.work<{ deliveryId: string }>(
		GITLAB_QUEUE,
		{ pollingIntervalSeconds: 0.5 },
		async (jobs: Job<{ deliveryId: string }>[]) => {
			for (const job of jobs) {
				await processGitlabDelivery(job.data.deliveryId);
			}
		},
	);
	return instance;
}

export async function startGitlabQueue() {
	if (boss) return boss;
	if (!starting) {
		starting = start().then((instance) => {
			boss = instance;
			return instance;
		});
	}
	return starting;
}

export async function stopGitlabQueue() {
	boss = null;
	starting = null;
	await stopBoss();
}

export async function enqueueGitlabDelivery(deliveryId: string) {
	const instance = await startGitlabQueue();
	const jobId = await instance.send(
		GITLAB_QUEUE,
		{ deliveryId },
		{ retryLimit: 5, retryDelay: 5, retryBackoff: true },
	);
	if (!jobId) throw new Error("The GitLab webhook job was not queued");
	return jobId;
}
