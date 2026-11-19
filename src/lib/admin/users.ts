/** The user shapes of `/api/admin/users`, and the two labels the user screens share. */

export type AdminGroupRef = { id: string; name: string; local: boolean };

export type AdminUserOrigin = "sso" | "imported" | "local";

export type AdminUser = {
	id: string;
	username: string;
	displayName: string;
	email: string | null;
	avatarUrl: string | null;
	active: boolean;
	isAdmin: boolean;
	adminLocal: boolean;
	groups: AdminGroupRef[];
	lastLoginAt: string | null;
	createdAt: string;
	hasPassword: boolean;
	hasSso: boolean;
	mustChangePassword: boolean;
	origin: AdminUserOrigin;
};

export type AdminUserToken = {
	id: string;
	name: string;
	createdAt: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
};

export type AdminUserDetail = AdminUser & {
	tokens: AdminUserToken[];
	sessionCount: number;
};

export function loginMethods(user: { hasPassword: boolean; hasSso: boolean }) {
	if (user.hasPassword && user.hasSso) return "Password, SSO";
	if (user.hasPassword) return "Password";
	if (user.hasSso) return "SSO";
	return "None";
}

export function originLabel(user: Pick<AdminUser, "origin" | "lastLoginAt">) {
	if (user.origin === "sso") return "from SSO";
	if (user.origin === "imported") {
		return user.lastLoginAt === null ? "imported, never logged in" : "imported";
	}
	return "local account";
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Something went wrong";
}

/** A named form action that keeps the page's query parameters (the user page needs `name`). */
export function formAction(
	url: { searchParams: { entries(): IterableIterator<[string, string]> } },
	name: string,
) {
	const params = new URLSearchParams();
	for (const [key, value] of url.searchParams.entries())
		params.append(key, value);
	params.set(`/${name}`, "");
	return `?${params.toString()}`;
}
