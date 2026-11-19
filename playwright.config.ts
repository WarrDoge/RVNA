import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "4960";
const baseURL = `http://127.0.0.1:${port}`;
// CI runs on a CPU-saturated runner several times slower than a workstation: a
// longer test and assertion timeout and a single retry. A test that fails its
// retry still fails the run. The specs share global rows, so one worker.
const ci = Boolean(process.env.CI);

export default defineConfig({
	testDir: "test/e2e",
	workers: 1,
	retries: ci ? 1 : 0,
	timeout: ci ? 120_000 : 30_000,
	expect: { timeout: ci ? 20_000 : 5_000 },
	use: { baseURL },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "node build",
		url: `${baseURL}/api/health`,
		reuseExistingServer: false,
		env: {
			NODE_ENV: "test",
			PORT: port,
			ORIGIN: baseURL,
			APP_URL: baseURL,
			APP_TIME_ZONE: "Europe/Helsinki",
			BODY_SIZE_LIMIT: "250M",
			MAX_UPLOAD_REQUEST_MB: "250",
			DEV_LOGIN_USER: "dev",
			SECRETS_KEY: "e2e-secrets-key-local-only",
		},
	},
});
