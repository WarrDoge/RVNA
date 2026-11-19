import { expect, test } from "vitest";
import {
	constantTimeEqual,
	decryptSecret,
	encryptSecret,
} from "../src/lib/server/gitlab/crypto.ts";

test("secrets round trip and use a fresh IV", () => {
	const first = encryptSecret("whsec_abcdef");
	const second = encryptSecret("whsec_abcdef");

	expect(first).not.toBe(second);
	expect(first.startsWith("v1:")).toBe(true);
	expect(decryptSecret(first)).toBe("whsec_abcdef");
	expect(decryptSecret(second)).toBe("whsec_abcdef");
});

test("a modified ciphertext is rejected", () => {
	const value = encryptSecret("token-value");
	const parts = value.split(":");
	const tampered = [...parts];
	tampered[3] = Buffer.from("different").toString("base64");

	expect(() => decryptSecret(tampered.join(":"))).toThrow();
	expect(() => decryptSecret("not-a-secret")).toThrow();
});

test("token comparison is length independent", () => {
	expect(constantTimeEqual("same-secret", "same-secret")).toBe(true);
	expect(constantTimeEqual("same-secret", "same-secreT")).toBe(false);
	expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
	expect(constantTimeEqual("", "")).toBe(true);
});
