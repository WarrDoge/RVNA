import { z } from "zod";

const APP_URL_PROTOCOLS = new Set(["http:", "https:"]);
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function isAppUrl(value: string) {
	return APP_URL_PROTOCOLS.has(new URL(value).protocol);
}

function isTimeZone(value: string) {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

const envSchema = z
	.object({
		DATABASE_URL: z.url(),
		PORT: z.coerce.number().int().positive().default(3000),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		APP_URL: z
			.url()
			.refine(isAppUrl, "APP_URL must be an http or https URL")
			.default("http://localhost:3000"),
		ORIGIN: z.url().optional(),
		APP_TIME_ZONE: z
			.string()
			.refine(isTimeZone, "APP_TIME_ZONE must be an IANA time zone")
			.default("UTC"),
		OIDC_ISSUER: z.url().optional(),
		OIDC_CLIENT_ID: z.string().optional(),
		OIDC_CLIENT_SECRET: z.string().optional(),
		OIDC_SCOPES: z.string().default("openid profile email"),
		OIDC_GROUPS_CLAIM: z.string().default("groups"),
		ADMIN_GROUP: z.string().default("rvna-admins"),
		SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
		DEV_LOGIN_USER: z.string().optional(),
		SSO_AUTO_REDIRECT: z.stringbool().default(false),
		BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
		BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
		ATTACHMENTS_DIR: z.string().default("./data/attachments"),
		AVATARS_DIR: z.string().default("./data/avatars"),
		MAX_ATTACHMENT_MB: z.coerce.number().int().positive().default(100),
		MAX_UPLOAD_REQUEST_MB: z.coerce.number().int().positive().default(250),
		SMTP_URL: z.url().optional(),
		MAIL_FROM: z.string().default("rvna <rvna@localhost>"),
		MAIL_REDIRECT_TO: z.email().optional(),
		SECRETS_KEY: z.string().min(16).optional(),
	})
	.superRefine((value, ctx) => {
		const oidcValues = [
			value.OIDC_ISSUER,
			value.OIDC_CLIENT_ID,
			value.OIDC_CLIENT_SECRET,
		];
		const configured = oidcValues.filter((item) => item !== undefined).length;

		if (configured > 0 && configured < oidcValues.length) {
			ctx.addIssue({
				code: "custom",
				path: ["OIDC_ISSUER"],
				message:
					"OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be set together",
			});
		}
		if (value.DEV_LOGIN_USER && value.NODE_ENV === "production") {
			ctx.addIssue({
				code: "custom",
				path: ["DEV_LOGIN_USER"],
				message: "DEV_LOGIN_USER must not be set when NODE_ENV=production",
			});
		}
		// NODE_ENV may be forgotten on a server; the address of the app is not.
		if (
			value.DEV_LOGIN_USER &&
			!LOOPBACK_HOSTS.includes(new URL(value.APP_URL).hostname)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["APP_URL"],
				message:
					"DEV_LOGIN_USER signs every visitor in as an administrator; it needs an APP_URL on localhost",
			});
		}
		if (
			(value.BOOTSTRAP_ADMIN_USERNAME === undefined) !==
			(value.BOOTSTRAP_ADMIN_PASSWORD === undefined)
		) {
			ctx.addIssue({
				code: "custom",
				path: ["BOOTSTRAP_ADMIN_PASSWORD"],
				message:
					"BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be set together",
			});
		}
		if (value.MAX_ATTACHMENT_MB > value.MAX_UPLOAD_REQUEST_MB) {
			ctx.addIssue({
				code: "custom",
				path: ["MAX_ATTACHMENT_MB"],
				message: "MAX_ATTACHMENT_MB must not exceed MAX_UPLOAD_REQUEST_MB",
			});
		}
	});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: Record<string, string | undefined>) {
	const parsed = envSchema.safeParse(
		Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "")),
	);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid environment:\n${details}`);
	}
	return parsed.data;
}

let cached: Env | undefined;

function load(): Env {
	cached ??= parseEnv(process.env);
	return cached;
}

/** Validation is deferred until a value is actually read, so importing a module has no side effect. */
export const env: Env = new Proxy({} as Env, {
	get(_target, property) {
		return load()[property as keyof Env];
	},
	has(_target, property) {
		return property in load();
	},
	ownKeys() {
		return Reflect.ownKeys(load());
	},
	getOwnPropertyDescriptor(_target, property) {
		return Reflect.getOwnPropertyDescriptor(load(), property);
	},
});

export function ssoConfigured() {
	return Boolean(
		env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET,
	);
}

/** What a start with this configuration should say aloud: allowed, but not safe on a real installation. */
export function configWarnings(config: Env = env): string[] {
	const warnings: string[] = [];
	const appUrl = new URL(config.APP_URL);
	if (
		config.NODE_ENV === "production" &&
		appUrl.protocol === "http:" &&
		!LOOPBACK_HOSTS.includes(appUrl.hostname)
	) {
		warnings.push(
			`APP_URL is ${config.APP_URL}: sign-in cookies travel without the Secure flag and no HSTS header is sent. Run RVNA behind TLS and set APP_URL to the https address.`,
		);
	}
	if (config.DEV_LOGIN_USER) {
		warnings.push(
			`DEV_LOGIN_USER is set: GET /auth/login signs every visitor in as the administrator "${config.DEV_LOGIN_USER}". Use it on a development machine only.`,
		);
	}
	return warnings;
}
