import { and, eq, isNull, lt, ne, sql } from "drizzle-orm";
import * as client from "openid-client";
import { createSession, randomValue, sha256, syncGroups } from "./auth.ts";
import { db } from "./db.ts";
import { env, ssoConfigured } from "./env.ts";
import { HttpError } from "./http.ts";
import { auditLog, oidcTransactions, sessions, users } from "./schema.ts";

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const TRANSACTION_CLEANUP_MS = 60 * 1000;
const TRANSACTION_PER_IP_LIMIT = 20;
let lastTransactionCleanup = 0;
function callbackUrl() {
	return new URL("/auth/callback", env.APP_URL);
}

let configuration: Promise<client.Configuration> | null = null;

function getConfiguration() {
	if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
		throw new Error("OIDC is not configured");
	}
	configuration ??= client
		.discovery(
			new URL(env.OIDC_ISSUER),
			env.OIDC_CLIENT_ID,
			env.OIDC_CLIENT_SECRET,
			undefined,
			env.NODE_ENV === "production"
				? undefined
				: { execute: [client.allowInsecureRequests] },
		)
		.catch((error: unknown) => {
			configuration = null;
			throw error;
		});
	return configuration;
}

export function safeReturnTo(value: string | undefined) {
	// Browsers drop tabs and newlines and read "\\" as "/", so "/\t/host" would leave the origin.
	if (
		!value?.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\") ||
		[...value].some((character) => character < " ")
	) {
		return "/";
	}
	const url = new URL(value, env.APP_URL);
	if (url.origin !== new URL(env.APP_URL).origin) return "/";
	// Dot segments collapse: "/..//host" becomes "//host", which a browser reads as another site.
	if (url.pathname.startsWith("//")) return "/";
	return url.pathname + url.search + url.hash;
}

async function cleanExpiredTransactions(now = Date.now()) {
	if (now - lastTransactionCleanup < TRANSACTION_CLEANUP_MS) return;
	lastTransactionCleanup = now;
	await db
		.delete(oidcTransactions)
		.where(lt(oidcTransactions.createdAt, new Date(now - TRANSACTION_TTL_MS)));
}

async function capTransactionsPerIp(clientIp: string) {
	await db.execute(sql`
		delete from oidc_transactions
		where client_ip = ${clientIp}
		  and id_hash not in (
			select id_hash from oidc_transactions
			where client_ip = ${clientIp}
			order by created_at desc
			limit ${TRANSACTION_PER_IP_LIMIT - 1}
		  )
	`);
}

function stringClaim(claims: Record<string, unknown>, key: string) {
	const value = claims[key];
	return typeof value === "string" ? value : undefined;
}

function groupNamesFromClaims(claims: Record<string, unknown>) {
	const value = claims[env.OIDC_GROUPS_CLAIM];
	// A provider that omits the claim says nothing about groups; it does not say
	// the user has none, so the memberships must stay as they are.
	if (!Array.isArray(value)) return null;
	return [
		...new Set(
			value.filter((item): item is string => typeof item === "string"),
		),
	];
}

type UpsertResult =
	| { user: typeof users.$inferSelect }
	| { refused: "inactive" | "conflict" };

/**
 * Finds the account for a verified IdP identity. An account holding a local
 * password is attached only when it was imported and the IdP vouches for the
 * same email; anything else that shares the username is refused, never
 * duplicated and never overwritten.
 */
async function upsertUser(
	claims: Record<string, unknown>,
): Promise<UpsertResult | null> {
	const sub = stringClaim(claims, "sub");
	if (!sub) return null;

	const username = stringClaim(claims, "preferred_username") ?? sub;
	const email = stringClaim(claims, "email") ?? null;
	const displayName = stringClaim(claims, "name") ?? username;
	const avatarUrl = stringClaim(claims, "picture") ?? null;
	const emailVerified = claims.email_verified === true;
	const emailMatches = (user: typeof users.$inferSelect) =>
		emailVerified &&
		email !== null &&
		user.email?.toLowerCase() === email.toLowerCase();
	const canAttach = (user: typeof users.$inferSelect) =>
		user.oidcSub === null &&
		(user.passwordHash === null ||
			(user.sourceKey !== null && emailMatches(user)));

	let [user] = await db
		.select()
		.from(users)
		.where(eq(users.oidcSub, sub))
		.limit(1);

	if (!user) {
		const [byUsername] = await db
			.select()
			.from(users)
			.where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
			.limit(1);
		if (byUsername) {
			if (!canAttach(byUsername)) return { refused: "conflict" };
			user = byUsername;
		}
	}

	if (!user && email && emailVerified) {
		const [byEmail] = await db
			.select()
			.from(users)
			.where(
				and(
					isNull(users.oidcSub),
					sql`lower(${users.email}) = ${email.toLowerCase()}`,
				),
			)
			.limit(1);
		if (byEmail && canAttach(byEmail)) user = byEmail;
	}

	const profile = {
		oidcSub: sub,
		username,
		email,
		displayName,
		avatarUrl,
		updatedAt: new Date(),
	};

	if (user) {
		if (!user.active) return { refused: "inactive" };
		const attaching = user.oidcSub === null;
		const [taken] = await db
			.select({ id: users.id })
			.from(users)
			.where(
				and(
					sql`lower(${users.username}) = ${username.toLowerCase()}`,
					ne(users.id, user.id),
				),
			)
			.limit(1);
		[user] = await db
			.update(users)
			.set(taken ? { ...profile, username: user.username } : profile)
			.where(eq(users.id, user.id))
			.returning();
		if (attaching) {
			await db.insert(auditLog).values({
				actorId: user.id,
				actorName: user.displayName,
				action: "account.link",
				entityType: "user",
				entityId: user.id,
				summary: `${user.username}: the first single sign-on attached an identity to this existing account`,
			});
		}
		return { user };
	}

	[user] = await db.insert(users).values(profile).returning();
	return { user };
}

async function devLogin(username: string, returnTo: string) {
	const [existing] = await db
		.select()
		.from(users)
		.where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
		.limit(1);

	let userId: string;
	if (existing) {
		await db
			.update(users)
			.set({ active: true, isAdmin: true, updatedAt: new Date() })
			.where(eq(users.id, existing.id));
		userId = existing.id;
	} else {
		const [created] = await db
			.insert(users)
			.values({ username, displayName: username, isAdmin: true })
			.returning();
		userId = created.id;
	}

	return { session: await createSession(userId, null), location: returnTo };
}

export function loginRedirectTarget(input: {
	returnTo?: string;
	local?: string;
}) {
	if (!ssoConfigured() || !env.SSO_AUTO_REDIRECT || input.local === "1") {
		return null;
	}
	return `/auth/login?returnTo=${encodeURIComponent(safeReturnTo(input.returnTo))}`;
}

export type LoginStart =
	| { kind: "session"; session: string; location: string }
	| { kind: "redirect"; transactionId: string; location: string };

export async function startLogin(input: {
	returnTo?: string;
	ip: string;
}): Promise<LoginStart> {
	const returnTo = safeReturnTo(input.returnTo);
	if (env.DEV_LOGIN_USER) {
		const dev = await devLogin(env.DEV_LOGIN_USER, returnTo);
		return { kind: "session", ...dev };
	}
	if (!ssoConfigured()) {
		throw new HttpError(404, "Single sign-on is not configured");
	}

	const config = await getConfiguration();
	const transactionId = randomValue();
	const codeVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
	const state = client.randomState();
	const nonce = client.randomNonce();

	await cleanExpiredTransactions();
	await capTransactionsPerIp(input.ip);
	await db.insert(oidcTransactions).values({
		idHash: sha256(transactionId),
		state,
		nonce,
		codeVerifier,
		returnTo,
		clientIp: input.ip,
	});

	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: callbackUrl().href,
		scope: env.OIDC_SCOPES,
		state,
		nonce,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});
	return { kind: "redirect", transactionId, location: url.href };
}

/** A callback failure that also has to drop the transaction cookie. */
export class OidcCallbackError extends HttpError {
	readonly clearTransaction: boolean;

	constructor(status: number, message: string, clearTransaction = false) {
		super(status, message);
		this.name = "OidcCallbackError";
		this.clearTransaction = clearTransaction;
	}
}

export type CallbackInput = {
	transactionId?: string;
	code?: string;
	state?: string;
	error?: string;
	url: URL;
};

export async function completeLogin(input: CallbackInput) {
	if (!ssoConfigured()) {
		throw new HttpError(404, "Single sign-on is not configured");
	}
	if (!input.transactionId) {
		throw new OidcCallbackError(400, "Login transaction is missing");
	}

	const [transaction] = await db
		.select()
		.from(oidcTransactions)
		.where(eq(oidcTransactions.idHash, sha256(input.transactionId)))
		.limit(1);
	if (!transaction) {
		throw new OidcCallbackError(400, "Login transaction is missing");
	}

	if (!input.state || input.state !== transaction.state) {
		await db
			.delete(oidcTransactions)
			.where(eq(oidcTransactions.idHash, transaction.idHash));
		throw new OidcCallbackError(400, "Login state does not match");
	}

	if (Date.now() - transaction.createdAt.getTime() > TRANSACTION_TTL_MS) {
		await db
			.delete(oidcTransactions)
			.where(eq(oidcTransactions.idHash, transaction.idHash));
		throw new OidcCallbackError(400, "Login transaction has expired");
	}

	if (input.error) {
		throw new OidcCallbackError(400, "Authorization was not granted");
	}

	const config = await getConfiguration();
	let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
	try {
		// The old exchange resolved the callback against APP_URL; ORIGIN may differ.
		tokens = await client.authorizationCodeGrant(
			config,
			new URL(input.url.pathname + input.url.search, env.APP_URL),
			{
				pkceCodeVerifier: transaction.codeVerifier,
				expectedState: transaction.state,
				expectedNonce: transaction.nonce,
				idTokenExpected: true,
			},
		);
	} catch (error) {
		console.warn("OIDC code exchange failed", error);
		throw new OidcCallbackError(400, "Authorization code exchange failed");
	}

	const claims = tokens.claims() as Record<string, unknown> | undefined;
	if (!claims) {
		throw new OidcCallbackError(400, "No identity token returned");
	}

	const result = await upsertUser(claims);
	if (!result || "refused" in result) {
		await db
			.delete(oidcTransactions)
			.where(eq(oidcTransactions.idHash, transaction.idHash));
		if (result?.refused === "conflict") {
			throw new OidcCallbackError(
				403,
				"An account with this username already exists. Ask an administrator to link it.",
				true,
			);
		}
		throw new OidcCallbackError(403, "This account is inactive", true);
	}
	const { user } = result;

	const groupNames = groupNamesFromClaims(claims);
	if (groupNames) await syncGroups(user.id, groupNames);

	const session = await createSession(user.id, tokens.id_token ?? null);
	await db
		.delete(oidcTransactions)
		.where(eq(oidcTransactions.idHash, transaction.idHash));

	return { session, returnTo: transaction.returnTo };
}

export async function logout(sessionId: string | undefined) {
	let idToken: string | null = null;

	if (sessionId) {
		const [deleted] = await db
			.delete(sessions)
			.where(eq(sessions.idHash, sha256(sessionId)))
			.returning({ idToken: sessions.idToken });
		idToken = deleted?.idToken ?? null;
	}

	if (!ssoConfigured() || !idToken) {
		return { redirect: "/" };
	}

	const config = await getConfiguration();
	if (!config.serverMetadata().end_session_endpoint) {
		return { redirect: "/" };
	}

	return {
		redirect: client.buildEndSessionUrl(config, {
			id_token_hint: idToken,
			post_logout_redirect_uri: new URL("/", env.APP_URL).href,
		}).href,
	};
}
