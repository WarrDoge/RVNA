import {
	createHash,
	createSign,
	generateKeyPairSync,
	randomBytes,
} from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";

export type MockUser = {
	sub: string;
	username: string;
	email?: string;
	emailVerified?: boolean;
	name?: string;
	picture?: string;
	groups?: string[];
};

export type MockIssuer = {
	issuer: string;
	setUser: (user: MockUser) => void;
	close: () => Promise<void>;
};

type AuthorizationCode = {
	nonce: string;
	codeChallenge: string;
	redirectUri: string;
	user: MockUser;
};

export async function startMockIssuer(options: {
	clientId: string;
	clientSecret: string;
}): Promise<MockIssuer> {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const jwk = publicKey.export({ format: "jwk" });
	const kid = "rvna-test-key";
	const codes = new Map<string, AuthorizationCode>();
	let issuer = "";
	let currentUser: MockUser = {
		sub: "default-user",
		username: "default",
		groups: [],
	};

	function signIdToken(user: MockUser, nonce: string) {
		const issuedAt = Math.floor(Date.now() / 1000);
		const encode = (value: unknown) =>
			Buffer.from(JSON.stringify(value)).toString("base64url");
		const header = encode({ alg: "RS256", typ: "JWT", kid });
		const payload = encode({
			iss: issuer,
			sub: user.sub,
			aud: options.clientId,
			iat: issuedAt,
			exp: issuedAt + 300,
			nonce,
			preferred_username: user.username,
			email: user.email,
			email_verified: user.emailVerified ?? false,
			name: user.name ?? user.username,
			picture: user.picture,
			groups: user.groups ?? [],
		});
		const data = `${header}.${payload}`;
		const signature = createSign("sha256")
			.update(data)
			.sign(privateKey)
			.toString("base64url");
		return `${data}.${signature}`;
	}

	function send(
		response: ServerResponse,
		status: number,
		body: unknown,
		headers: Record<string, string> = {},
	) {
		response.writeHead(status, {
			"content-type": "application/json; charset=utf-8",
			...headers,
		});
		response.end(JSON.stringify(body));
	}

	function redirect(response: ServerResponse, location: string) {
		response.writeHead(302, { location });
		response.end();
	}

	async function readForm(request: IncomingMessage) {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		return Object.fromEntries(
			new URLSearchParams(Buffer.concat(chunks).toString()),
		);
	}

	function authorize(url: URL, response: ServerResponse) {
		const query = Object.fromEntries(url.searchParams) as Record<
			string,
			string | undefined
		>;
		if (query.client_id !== options.clientId) {
			return send(response, 400, { error: "invalid_client" });
		}
		if (!query.redirect_uri || !query.state || !query.code_challenge) {
			return send(response, 400, { error: "invalid_request" });
		}

		const code = randomBytes(16).toString("base64url");
		codes.set(code, {
			nonce: query.nonce ?? "",
			codeChallenge: query.code_challenge,
			redirectUri: query.redirect_uri,
			user: currentUser,
		});

		const target = new URL(query.redirect_uri);
		target.searchParams.set("code", code);
		target.searchParams.set("state", query.state);
		redirect(response, target.href);
	}

	async function token(request: IncomingMessage, response: ServerResponse) {
		const body = (await readForm(request)) as Record<
			string,
			string | undefined
		>;
		if (body.grant_type !== "authorization_code") {
			return send(response, 400, { error: "unsupported_grant_type" });
		}

		const code = body.code;
		const record = code ? codes.get(code) : undefined;
		if (!code || !record) {
			return send(response, 400, { error: "invalid_grant" });
		}
		codes.delete(code);

		const verifier = body.code_verifier;
		const challenge = verifier
			? createHash("sha256").update(verifier).digest("base64url")
			: "";
		if (
			body.redirect_uri !== record.redirectUri ||
			challenge !== record.codeChallenge
		) {
			return send(response, 400, { error: "invalid_grant" });
		}

		const authorization = request.headers.authorization;
		const basic = authorization?.startsWith("Basic ")
			? Buffer.from(authorization.slice(6), "base64").toString().split(":")
			: undefined;
		const clientId = basic?.[0] ?? body.client_id;
		const clientSecret = basic?.[1] ?? body.client_secret;
		if (
			clientId !== options.clientId ||
			clientSecret !== options.clientSecret
		) {
			return send(response, 401, { error: "invalid_client" });
		}

		send(response, 200, {
			access_token: randomBytes(16).toString("base64url"),
			token_type: "Bearer",
			expires_in: 3600,
			id_token: signIdToken(record.user, record.nonce),
		});
	}

	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", issuer || "http://127.0.0.1");
		const route = `${request.method} ${url.pathname}`;
		if (route === "GET /.well-known/openid-configuration") {
			return send(response, 200, discovery());
		}
		if (route === "GET /jwks") {
			return send(response, 200, {
				keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }],
			});
		}
		if (route === "GET /authorize") return authorize(url, response);
		if (route === "POST /token") {
			void token(request, response);
			return;
		}
		if (route === "GET /end_session") {
			const target = url.searchParams.get("post_logout_redirect_uri");
			return redirect(
				response,
				(target ? new URL(target) : new URL("/", issuer)).href,
			);
		}
		send(response, 404, { error: "not_found" });
	});

	function discovery() {
		return {
			issuer,
			authorization_endpoint: `${issuer}/authorize`,
			token_endpoint: `${issuer}/token`,
			jwks_uri: `${issuer}/jwks`,
			end_session_endpoint: `${issuer}/end_session`,
			response_types_supported: ["code"],
			subject_types_supported: ["public"],
			id_token_signing_alg_values_supported: ["RS256"],
			token_endpoint_auth_methods_supported: [
				"client_secret_post",
				"client_secret_basic",
			],
			code_challenge_methods_supported: ["S256"],
			scopes_supported: ["openid", "profile", "email"],
			grant_types_supported: ["authorization_code"],
			claims_supported: [
				"sub",
				"iss",
				"aud",
				"exp",
				"iat",
				"nonce",
				"preferred_username",
				"email",
				"email_verified",
				"name",
				"picture",
				"groups",
			],
		};
	}

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Mock issuer failed to listen");
	}
	issuer = `http://127.0.0.1:${address.port}`;

	return {
		issuer,
		setUser: (user) => {
			currentUser = user;
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
