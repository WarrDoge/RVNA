/** Macros the editor has a dialog and preview for; every other macro is kept as an opaque labelled box. */
export const knownMacros = new Set([
	"toc",
	"code",
	"info",
	"tip",
	"note",
	"warning",
	"panel",
	"children",
	"jira",
	"view-file",
	"recently-updated",
	"contributors",
	"contentbylabel",
	"widget",
	"attachments",
	"anchor",
	"details",
	"detailssummary",
	"expand",
	"create-from-template",
	"livesearch",
	"popular-labels",
	"noformat",
	"excerpt",
	"include",
	"status",
]);

/** Macros whose storage form is inline text-level (kept as inlineMacro when found inside text). */
export const inlineMacroNames = new Set(["anchor", "jira", "status"]);
