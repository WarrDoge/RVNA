import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const argon2Async = promisify(argon2);

/** Parameters used for new hashes; raise them here and `verifyPassword` reports `needsRehash`. */
export const hashParameters = {
	memory: 65536,
	passes: 3,
	parallelism: 1,
	tagLength: 32,
};
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;

const commonPasswords = new Set(
	[
		"password1234",
		"passwordpassword",
		"123456789012",
		"1234567890123",
		"12345678901234",
		"qwertyuiop12",
		"qwertyuiopas",
		"qwertyuiopasdf",
		"qwertyuiop123",
		"qwerty123456",
		"abc123456789",
		"iloveyou1234",
		"letmein12345",
		"welcome12345",
		"administrator",
		"admin1234567",
		"adminadminadmin",
		"changeme1234",
		"changemechangeme",
		"password12345",
		"password123456",
		"passw0rd1234",
		"p@ssw0rd1234",
		"correcthorsebatterystaple",
		"111111111111",
		"000000000000",
		"aaaaaaaaaaaa",
		"zxcvbnm12345",
		"monkey123456",
		"dragon123456",
		"football1234",
		"baseball1234",
		"trustno11234",
		"sunshine1234",
		"princess1234",
		"rvna123",
		"rvna1234",
		"jirajirajira",
	].map((value) => value.toLowerCase()),
);

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(
	password: string,
	username: string,
): string | null {
	if ([...password].length < MIN_PASSWORD_LENGTH) {
		return `The password must be at least ${MIN_PASSWORD_LENGTH} characters long`;
	}
	if (password.length > MAX_PASSWORD_LENGTH) {
		return `The password must be at most ${MAX_PASSWORD_LENGTH} characters long`;
	}
	const lower = password.toLowerCase();
	if (lower === username.toLowerCase()) {
		return "The password must not be the username";
	}
	if (commonPasswords.has(lower)) return "This password is too common";
	return null;
}

export function generatePassword() {
	return randomBytes(18).toString("base64url");
}

type Parameters = typeof hashParameters;

function encode(parameters: Parameters, salt: Buffer, tag: Buffer) {
	return `$argon2id$v=19$m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism}$${salt.toString("base64")}$${tag.toString("base64")}`;
}

type Parsed = { parameters: Parameters; salt: Buffer; tag: Buffer };

function parse(stored: string): Parsed | null {
	const match = stored.match(
		/^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/,
	);
	if (!match) return null;
	const salt = Buffer.from(match[4] as string, "base64");
	const tag = Buffer.from(match[5] as string, "base64");
	return {
		parameters: {
			memory: Number(match[1]),
			passes: Number(match[2]),
			parallelism: Number(match[3]),
			tagLength: tag.length,
		},
		salt,
		tag,
	};
}

function derive(password: string, parameters: Parameters, salt: Buffer) {
	return argon2Async("argon2id", {
		message: Buffer.from(password, "utf8"),
		nonce: salt,
		memory: parameters.memory,
		passes: parameters.passes,
		parallelism: parameters.parallelism,
		tagLength: parameters.tagLength,
	});
}

/** Argon2id with a random 16-byte salt; the parameters travel inside the returned string. */
export async function hashPassword(password: string) {
	const salt = randomBytes(16);
	return encode(
		hashParameters,
		salt,
		await derive(password, hashParameters, salt),
	);
}

let dummyHash: Promise<string> | undefined;

/**
 * Constant-time verify. Pass `null` for an unknown user: it still does a full
 * derivation so response time does not reveal which usernames exist.
 */
export async function verifyPassword(
	password: string,
	stored: string | null,
): Promise<{ ok: boolean; needsRehash: boolean }> {
	const parsed = stored ? parse(stored) : null;
	if (!parsed) {
		dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
		const dummy = parse(await dummyHash) as Parsed;
		await derive(password, dummy.parameters, dummy.salt);
		return { ok: false, needsRehash: false };
	}
	const candidate = await derive(password, parsed.parameters, parsed.salt);
	const ok =
		candidate.length === parsed.tag.length &&
		timingSafeEqual(candidate, parsed.tag);
	const current = hashParameters;
	const needsRehash =
		ok &&
		(parsed.parameters.memory !== current.memory ||
			parsed.parameters.passes !== current.passes ||
			parsed.parameters.parallelism !== current.parallelism ||
			parsed.parameters.tagLength !== current.tagLength);
	return { ok, needsRehash };
}
