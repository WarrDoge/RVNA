import { z } from "zod";

const importerEnvSchema = z
	.object({
		DATABASE_URL: z.url(),
		JIRA_URL: z.url().optional(),
		JIRA_PAT: z.string().min(1).optional(),
		CONFLUENCE_URL: z.url().optional(),
		CONFLUENCE_PAT: z.string().min(1).optional(),
		ATTACHMENTS_DIR: z.string().min(1).default("./data/attachments"),
		AVATARS_DIR: z.string().min(1).default("./data/avatars"),
	})
	.superRefine((value, ctx) => {
		if ((value.JIRA_URL === undefined) !== (value.JIRA_PAT === undefined)) {
			ctx.addIssue({
				code: "custom",
				message: "JIRA_URL and JIRA_PAT must be set together",
			});
		}
		if (
			(value.CONFLUENCE_URL === undefined) !==
			(value.CONFLUENCE_PAT === undefined)
		) {
			ctx.addIssue({
				code: "custom",
				message: "CONFLUENCE_URL and CONFLUENCE_PAT must be set together",
			});
		}
	});

export type ImporterEnv = z.infer<typeof importerEnvSchema>;

export function parseImporterEnv(
	raw: Record<string, string | undefined>,
): ImporterEnv {
	const parsed = importerEnvSchema.safeParse(
		Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "")),
	);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid importer environment:\n${details}`);
	}
	return parsed.data;
}

let cached: ImporterEnv | undefined;

function loadImporterEnv() {
	cached ??= parseImporterEnv(process.env);
	return cached;
}

/** Validation is deferred until a value is actually read, so importing a module has no side effect. */
export const importerEnv: ImporterEnv = new Proxy({} as ImporterEnv, {
	get(_target, property) {
		return loadImporterEnv()[property as keyof ImporterEnv];
	},
	has(_target, property) {
		return property in loadImporterEnv();
	},
	ownKeys() {
		return Reflect.ownKeys(loadImporterEnv());
	},
	getOwnPropertyDescriptor(_target, property) {
		return Reflect.getOwnPropertyDescriptor(loadImporterEnv(), property);
	},
});

export function requiredEnv<K extends keyof ImporterEnv>(
	name: K,
): NonNullable<ImporterEnv[K]> {
	const value = importerEnv[name];
	if (value === undefined) throw new Error(`${String(name)} is required`);
	return value as NonNullable<ImporterEnv[K]>;
}
