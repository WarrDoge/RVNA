import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { expect, test } from "vitest";
import {
	constantTimeEqual,
	decryptSecret,
	encryptSecret,
} from "../src/lib/server/gitlab/crypto.ts";

function legacyKey() {
	const secret = process.env.SECRETS_KEY;
	if (!secret) throw new Error("SECRETS_KEY is not set");
	return createHash("sha256").update(secret).digest();
}

function legacyEncrypt(plain: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", legacyKey(), iv);
	const encrypted = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	return [
		"v1",
		iv.toString("base64"),
		cipher.getAuthTag().toString("base64"),
		encrypted.toString("base64"),
	].join(":");
}

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

test("the encryption key is not a bare SHA-256 of SECRETS_KEY", () => {
	const value = encryptSecret("token-value");
	const [, iv, tag, encrypted] = value.split(":");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		legacyKey(),
		Buffer.from(iv as string, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tag as string, "base64"));

	expect(() =>
		Buffer.concat([
			decipher.update(Buffer.from(encrypted as string, "base64")),
			decipher.final(),
		]),
	).toThrow();
});

test("values encrypted before the key derivation changed still decrypt", () => {
	expect(decryptSecret(legacyEncrypt("whsec_legacy"))).toBe("whsec_legacy");
});

test("malformed stored values fail with the readable message", () => {
	const iv = Buffer.alloc(12).toString("base64");
	const tag = Buffer.alloc(16).toString("base64");
	const encrypted = Buffer.from("x").toString("base64");
	for (const value of [
		"v1:!!!!:!!!!:!!!!",
		`v1:${Buffer.alloc(8).toString("base64")}:${tag}:${encrypted}`,
		`v1:${iv}:${Buffer.alloc(8).toString("base64")}:${encrypted}`,
		`v1:${iv}:${tag}:${encrypted}:extra`,
	]) {
		expect(() => decryptSecret(value)).toThrow("Stored secret is not readable");
	}
});

test("token comparison is length independent", () => {
	expect(constantTimeEqual("same-secret", "same-secret")).toBe(true);
	expect(constantTimeEqual("same-secret", "same-secreT")).toBe(false);
	expect(constantTimeEqual("short", "a-much-longer-secret")).toBe(false);
	expect(constantTimeEqual("", "")).toBe(true);
});
