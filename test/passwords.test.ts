import { expect, test, vi } from "vitest";

type Derivation = {
	memory?: number;
	passes?: number;
	parallelism?: number;
	tagLength?: number;
};

const derivations: Derivation[] = [];
let failures = 0;

vi.mock("node:util", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:util")>();
	return {
		...actual,
		promisify: () => async (_algorithm: string, options: Derivation) => {
			if (failures > 0) {
				failures -= 1;
				throw new Error("argon2 failed");
			}
			derivations.push({ ...options });
			return Buffer.alloc(options.tagLength ?? 32);
		},
	};
});

const password = "a password long enough";

test("a failed dummy hash is retried instead of cached", async () => {
	const { verifyPassword } = await import("../src/lib/server/passwords.ts");
	failures = 1;
	await expect(verifyPassword(password, null)).rejects.toThrow("argon2 failed");
	expect(await verifyPassword(password, null)).toEqual({
		ok: false,
		needsRehash: false,
	});
});

test("a stored hash with out-of-range argon2 parameters is unparseable", async () => {
	const { hashPassword, verifyPassword } = await import(
		"../src/lib/server/passwords.ts"
	);
	const hash = await hashPassword(password);
	expect(await verifyPassword(password, hash)).toEqual({
		ok: true,
		needsRehash: false,
	});

	const tampered = [
		["memory", hash.replace("m=65536", "m=4000000")],
		["passes", hash.replace("t=3", "t=100000")],
		["parallelism", hash.replace("p=1", "p=64")],
		["tag", hash.replace(/\$[^$]+$/, "$c2hvcnQ=")],
	] as const;

	for (const [label, stored] of tampered) {
		derivations.length = 0;
		expect(await verifyPassword(password, stored), label).toEqual({
			ok: false,
			needsRehash: false,
		});
		expect(
			derivations.every(
				(item) =>
					item.memory === 65536 &&
					item.passes === 3 &&
					item.parallelism === 1 &&
					item.tagLength === 32,
			),
			label,
		).toBe(true);
	}
});
