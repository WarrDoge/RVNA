import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { startMockIssuer } from "./oidc-mock.ts";

const clientId = "rvna-test";
const clientSecret = "rvna-test-secret";
const adminGroup = `rvna-admins-${Math.random().toString(36).slice(2, 10)}`;

process.env.NODE_ENV = "test";
process.env.APP_URL = "http://127.0.0.1:3000";
process.env.OIDC_CLIENT_ID = clientId;
process.env.OIDC_CLIENT_SECRET = clientSecret;
process.env.ADMIN_GROUP = adminGroup;
process.env.OIDC_SCOPES = "openid profile email";
process.env.SECRETS_KEY = `test-secrets-key-${Math.random().toString(36).slice(2)}`;
process.env.OIDC_GROUPS_CLAIM = "groups";
delete process.env.DEV_LOGIN_USER;
const attachmentsDir = await mkdtemp(join(tmpdir(), "rvna-test-"));
process.env.ATTACHMENTS_DIR = attachmentsDir;
process.env.AVATARS_DIR = join(attachmentsDir, "avatars");
// Keep the request-wide upload cap reachable in a test without a 250 MB body.
process.env.MAX_UPLOAD_REQUEST_MB = "1";

const issuer = await startMockIssuer({ clientId, clientSecret });
process.env.OIDC_ISSUER = issuer.issuer;

Object.assign(globalThis, { oidcMock: issuer, adminGroup });

afterAll(async () => {
	await issuer.close();
	await rm(attachmentsDir, { recursive: true, force: true });
});
