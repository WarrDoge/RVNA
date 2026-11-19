import { z } from "zod";

const importerEnvSchema = z.object({
	DATABASE_URL: z.url(),
	JIRA_URL: z.url().optional(),
	JIRA_PAT: z.string().min(1).optional(),
	CONFLUENCE_URL: z.url().optional(),
	CONFLUENCE_PAT: z.string().min(1).optional(),
	ATTACHMENTS_DIR: z.string().default("./data/attachments"),
	AVATARS_DIR: z.string().default("./data/avatars"),
});

const parsed = importerEnvSchema.safeParse(process.env);

if (!parsed.success) {
	const details = parsed.error.issues
		.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
		.join("\n");
	throw new Error(`Invalid importer environment:\n${details}`);
}

export const importerEnv = parsed.data;

export function requiredEnv<K extends keyof typeof importerEnv>(
	name: K,
): NonNullable<(typeof importerEnv)[K]> {
	const value = importerEnv[name];
	if (value === undefined) throw new Error(`${String(name)} is required`);
	return value as NonNullable<(typeof importerEnv)[K]>;
}
