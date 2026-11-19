import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) {
	process.loadEnvFile(".env");
}

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		setupFiles: ["./test/setup.ts"],
		fileParallelism: false,
		...(process.env.CI && { testTimeout: 30_000, hookTimeout: 30_000 }),
	},
});
