import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scryptSync,
	timingSafeEqual,
} from "node:crypto";
import { env } from "../env.ts";

const VERSION = "v1";
const KDF_SALT = "rvna-secrets-key-v1";

let cached: { secret: string; key: Buffer } | null = null;

function secret(): string {
	const value = env.SECRETS_KEY;
	if (!value) {
		throw new Error("SECRETS_KEY is not set");
	}
	return value;
}

function key(): Buffer {
	const value = secret();
	if (cached?.secret !== value) {
		cached = { secret: value, key: scryptSync(value, KDF_SALT, 32) };
	}
	return cached.key;
}

function legacyKey(): Buffer {
	return createHash("sha256").update(secret()).digest();
}

function decryptWith(
	key: Buffer,
	iv: Buffer,
	tag: Buffer,
	encrypted: Buffer,
): string {
	const decipher = createDecipheriv("aes-256-gcm", key, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
		"utf8",
	);
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
	const parts = value.split(":");
	if (parts.length !== 4) {
		throw new Error("Stored secret is not readable");
	}
	const [version, iv, tag, encrypted] = parts;
	if (version !== VERSION || !iv || !tag || !encrypted) {
		throw new Error("Stored secret is not readable");
	}
	const ivBytes = Buffer.from(iv, "base64");
	const tagBytes = Buffer.from(tag, "base64");
	const encryptedBytes = Buffer.from(encrypted, "base64");
	if (
		ivBytes.length !== 12 ||
		tagBytes.length !== 16 ||
		encryptedBytes.length === 0
	) {
		throw new Error("Stored secret is not readable");
	}
	const currentKey = key();
	try {
		return decryptWith(currentKey, ivBytes, tagBytes, encryptedBytes);
	} catch {
		try {
			return decryptWith(legacyKey(), ivBytes, tagBytes, encryptedBytes);
		} catch {
			throw new Error("Stored secret is not readable");
		}
	}
}

export function constantTimeEqual(left: string, right: string): boolean {
	const a = createHash("sha256").update(left).digest();
	const b = createHash("sha256").update(right).digest();
	return timingSafeEqual(a, b);
}
