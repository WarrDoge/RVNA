import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (path: string) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the image and the chart run with NODE_ENV=production, which refuses DEV_LOGIN_USER", () => {
	expect(read("Dockerfile")).toMatch(/^ENV NODE_ENV=production$/m);
	expect(read("chart/templates/deployment.yaml")).toMatch(
		/- name: NODE_ENV\s+value: production/,
	);
	expect(read("docker-compose.yml")).toMatch(/NODE_ENV: production/);
});

test("the chart refuses DEV_LOGIN_USER in extraEnv, and no deployment file sets it", () => {
	const template = read("chart/templates/deployment.yaml");
	expect(template).toMatch(
		/has "DEV_LOGIN_USER" \$extraEnvNames[\s\S]*fail "extraEnv must not set DEV_LOGIN_USER/,
	);
	for (const path of [
		"Dockerfile",
		"docker-compose.yml",
		"chart/values.yaml",
		"chart/ci-values.yaml",
	]) {
		expect(read(path), path).not.toContain("DEV_LOGIN_USER");
	}
});
