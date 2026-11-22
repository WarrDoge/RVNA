import type { CustomFieldSpec, UserRef } from "#lib/api-types.ts";

export type StoredUser = { id: string; name: string; displayName: string };
export type StoredOption = { id?: string; value: string };
export type StoredCascading = StoredOption & { child?: StoredOption };

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function optionOf(value: unknown): StoredOption | null {
	const record = asRecord(value);
	if (!record || typeof record.value !== "string") return null;
	return {
		id: typeof record.id === "string" ? record.id : undefined,
		value: record.value,
	};
}

export function cascadingOf(value: unknown): StoredCascading | null {
	const parent = optionOf(value);
	if (!parent) return null;
	const child = optionOf(asRecord(value)?.child);
	return child ? { ...parent, child } : parent;
}

export function optionsOf(value: unknown): StoredOption[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => optionOf(item))
		.filter((item): item is StoredOption => item !== null);
}

export function stringsOf(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

export function usersOf(value: unknown): StoredUser[] {
	const list = Array.isArray(value) ? value : [];
	return list
		.map((item) => toUserRef(item))
		.filter((item): item is UserRef => item !== null)
		.map((user) => ({
			id: user.id,
			name: user.username,
			displayName: user.displayName,
		}));
}

export function toUserRef(value: unknown): UserRef | null {
	const record = asRecord(value);
	if (!record || typeof record.id !== "string") return null;
	const displayName =
		typeof record.displayName === "string"
			? record.displayName
			: typeof record.name === "string"
				? record.name
				: record.id;
	return {
		id: record.id,
		username: typeof record.name === "string" ? record.name : displayName,
		displayName,
		avatarUrl: null,
	};
}

/** A custom URL value is clickable only when it is an absolute http(s) URL. */
export function httpUrl(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

export function toStoredUser(user: UserRef): StoredUser {
	return {
		id: user.id,
		name: user.username,
		displayName: user.displayName,
	};
}

/** Enabled options, plus the value already stored even when it was disabled since. */
export function visibleOptions<
	T extends { id: string; value: string; disabled: boolean },
>(options: T[], selected: StoredOption | null): T[] {
	const enabled = options.filter((option) => !option.disabled);
	if (
		selected &&
		!enabled.some(
			(option) =>
				option.id === selected.id ||
				(selected.id === undefined && option.value === selected.value),
		)
	) {
		const stored = options.find(
			(option) => option.id === selected.id || option.value === selected.value,
		);
		if (stored) return [...enabled, stored];
	}
	return enabled;
}

export function isEmptyFieldValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/**
 * Client-side checks that mirror the server's: they only spare a round trip,
 * the server stays the authority and its message wins.
 */
export function fieldValueProblem(
	field: CustomFieldSpec,
	value: unknown,
): string | null {
	if (isEmptyFieldValue(value)) return null;
	if (field.type === "url") {
		const text = typeof value === "string" ? value.trim() : "";
		if (!/^https?:\/\//i.test(text)) {
			return "Enter a full address starting with http:// or https://";
		}
		try {
			new URL(text);
		} catch {
			return "Enter a valid web address";
		}
		return text.length > 2000
			? "The address is longer than 2000 characters"
			: null;
	}
	if (
		field.type === "text" &&
		typeof value === "string" &&
		value.length > 255
	) {
		return "Use 255 characters or fewer";
	}
	if (field.type === "number") {
		return typeof value === "number" && Number.isFinite(value)
			? null
			: "Enter a number";
	}
	return null;
}
