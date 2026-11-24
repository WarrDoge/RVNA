import { expect, test } from "vitest";
import { configWarnings, parseEnv } from "../src/lib/server/env.ts";

const base = { DATABASE_URL: "postgres://rvna:rvna@127.0.0.1:1/unreachable" };

function envError(overrides: Record<string, string>) {
	try {
		parseEnv({ ...base, ...overrides });
	} catch (error) {
		return (error as Error).message;
	}
	throw new Error("parseEnv accepted the environment");
}

test("APP_URL only accepts http and https", () => {
	expect(envError({ APP_URL: "javascript:alert(1)" })).toMatch(
		/APP_URL: APP_URL must be an http or https URL/,
	);
	expect(
		parseEnv({ ...base, APP_URL: "https://tracker.example.com" }).APP_URL,
	).toBe("https://tracker.example.com");
});

test("APP_TIME_ZONE must be a zone Intl accepts", () => {
	expect(envError({ APP_TIME_ZONE: "Europe/Helsink" })).toMatch(
		/APP_TIME_ZONE: APP_TIME_ZONE must be an IANA time zone/,
	);
	expect(
		parseEnv({ ...base, APP_TIME_ZONE: "Europe/Helsinki" }).APP_TIME_ZONE,
	).toBe("Europe/Helsinki");
});

test("the per-attachment cap cannot exceed the request cap", () => {
	expect(
		envError({ MAX_ATTACHMENT_MB: "300", MAX_UPLOAD_REQUEST_MB: "250" }),
	).toMatch(
		/MAX_ATTACHMENT_MB: MAX_ATTACHMENT_MB must not exceed MAX_UPLOAD_REQUEST_MB/,
	);
	expect(
		parseEnv({
			...base,
			MAX_ATTACHMENT_MB: "100",
			MAX_UPLOAD_REQUEST_MB: "250",
		}).MAX_ATTACHMENT_MB,
	).toBe(100);
});

test("SMTP_URL must be a URL", () => {
	expect(envError({ SMTP_URL: "smtp//mail.example.com" })).toMatch(/SMTP_URL:/);
	expect(
		parseEnv({ ...base, SMTP_URL: "smtp://user:pass@mail.example.com:25" })
			.SMTP_URL,
	).toBe("smtp://user:pass@mail.example.com:25");
});

test("a cross-field error names the variable it belongs to", () => {
	expect(envError({ OIDC_CLIENT_ID: "client" })).toMatch(
		/OIDC_ISSUER: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be set together/,
	);
	expect(envError({ NODE_ENV: "production", DEV_LOGIN_USER: "dev" })).toMatch(
		/DEV_LOGIN_USER: DEV_LOGIN_USER must not be set/,
	);
	expect(
		envError({
			APP_URL: "https://tracker.example.com",
			DEV_LOGIN_USER: "dev",
		}),
	).toMatch(/APP_URL: DEV_LOGIN_USER signs every visitor in/);
	expect(envError({ BOOTSTRAP_ADMIN_USERNAME: "admin" })).toMatch(
		/BOOTSTRAP_ADMIN_PASSWORD: BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be set together/,
	);
});

test("a production start on plain http warns once, unless the address is local", () => {
	const production = { ...base, NODE_ENV: "production" };
	const plain = configWarnings(
		parseEnv({ ...production, APP_URL: "http://tracker.example.com" }),
	);
	expect(plain).toHaveLength(1);
	expect(plain[0]).toMatch(/behind TLS/);

	for (const APP_URL of [
		"https://tracker.example.com",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
	]) {
		expect(configWarnings(parseEnv({ ...production, APP_URL }))).toEqual([]);
	}
	expect(
		configWarnings(
			parseEnv({ ...base, APP_URL: "http://tracker.example.com" }),
		),
	).toEqual([]);
});

test("an armed DEV_LOGIN_USER is announced at start", () => {
	const warnings = configWarnings(parseEnv({ ...base, DEV_LOGIN_USER: "dev" }));
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatch(/DEV_LOGIN_USER is set/);
	expect(configWarnings(parseEnv(base))).toEqual([]);
});
