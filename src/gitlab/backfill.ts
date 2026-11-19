import { parseArgs } from "node:util";
import { pool, runMigrations } from "../lib/server/db.ts";
import { backfillProject } from "../lib/server/gitlab/backfill.ts";
import { GitlabApi } from "../lib/server/gitlab/client.ts";
import { gitlabSettings } from "../lib/server/gitlab/config.ts";

const { values } = parseArgs({
	options: {
		project: { type: "string" },
		days: { type: "string" },
	},
});

if (!values.project) {
	console.error(
		"Usage: npm run gitlab:backfill -- --project <group/project> [--days 90]",
	);
	process.exit(1);
}

await runMigrations();
const settings = await gitlabSettings();
if (!settings.baseUrl || !settings.accessToken) {
	console.error(
		"Set the GitLab base URL and access token on /plugins/servlet/gitlab first",
	);
	await pool.end();
	process.exit(1);
}

const days = values.days ? Number(values.days) : 90;
if (!Number.isFinite(days) || days <= 0) {
	console.error("--days must be a positive number");
	await pool.end();
	process.exit(1);
}

try {
	const result = await backfillProject(
		new GitlabApi(settings.baseUrl, settings.accessToken),
		values.project,
		{ days },
	);
	console.log(
		`${result.path}: ${result.branches} branches, ${result.commits} commits, ${result.mergeRequests} merge requests`,
	);
} finally {
	await pool.end();
}
