import { env } from "../env.ts";

export const SUMMARY_LIMIT = 255;
// Escaping can grow text six times and the cut adds a mark; the portal accepts at most 200,000 characters of HTML.
export const DESCRIPTION_LIMIT = 33_000;
export const COMMENT_NOTICE_LIMIT = 300;
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10 * 60 * 1000;

export function escapeHtml(text: string) {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Plain Matrix text takes the same sanitising path as the portal's rich text. */
export function plainTextToHtml(text: string) {
	return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

export function truncate(text: string, limit: number) {
	const chars = [...text];
	return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

export function appOrigin() {
	return (process.env.ORIGIN ?? env.APP_URL).replace(/\/+$/, "");
}

export function portalRequestLink(deskId: string, key: string) {
	return `${appOrigin()}/servicedesk/customer/portal/${deskId}/${key}`;
}

export function portalCreateLink(deskId: string, requestTypeId: string) {
	return `${appOrigin()}/servicedesk/customer/portal/${deskId}/create/${requestTypeId}`;
}

export function helpText() {
	return [
		"Commands:",
		"!ticket <summary> — open a service desk request",
		"!status KEY-123 — see a request's status",
		"!link CODE — connect this Matrix account to your profile",
		"!help — this list",
	].join("\n");
}

export function unknownSenderText() {
	return `I do not know which RVNA user you are. Open your profile at ${appOrigin()}/secure/ViewProfile.jspa, click "Connect to messenger" and send the code with !link.`;
}

export function usageText() {
	return "Usage: !ticket <summary>";
}
