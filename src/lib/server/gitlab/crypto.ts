import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { env } from "../env.ts";

const VERSION = "v1";

function key(): Buffer {
	const secret = env.SECRETS_KEY;
	if (!secret) {
		throw new Error("SECRETS_KEY is not set");
	}
	return createHash("sha256").update(secret).digest();
}

export function encryptionAvailable() {
	return env.SECRETS_KEY !== undefined;
}

export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key(), iv);
	const encrypted = Buffer.concat([
		cipher.update(plain, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return [
		VERSION,
		iv.toString("base64"),
		tag.toString("base64"),
		encrypted.toString("base64"),
	].join(":");
}

export function decryptSecret(value: string): string {
	const [version, iv, tag, encrypted] = value.split(":");
	if (version !== VERSION || !iv || !tag || !encrypted) {
		throw new Error("Stored secret is not readable");
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key(),
		Buffer.from(iv, "base64"),
	);
	decipher.setAuthTag(Buffer.from(tag, "base64"));
	return Buffer.concat([
		decipher.update(Buffer.from(encrypted, "base64")),
		decipher.final(),
	]).toString("utf8");
}

export function constantTimeEqual(left: string, right: string): boolean {
	const a = createHash("sha256").update(left).digest();
	const b = createHash("sha256").update(right).digest();
	return timingSafeEqual(a, b);
}
