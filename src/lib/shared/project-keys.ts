export const projectKeyRule =
	"Project keys must be 2 to 10 characters long, start with a letter, and contain only uppercase letters and digits (for example DEMO or OPS2)";

export function projectKeyError(key: string): string | null {
	if (key === "") return "Enter a project key";
	if (key !== key.toUpperCase())
		return `Use uppercase letters in the project key. ${projectKeyRule}`;
	if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) return projectKeyRule;
	return null;
}
