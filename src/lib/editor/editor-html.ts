/** The editor's empty check. */
export function isEditorEmpty(html: string) {
	const trimmed = html.trim();
	return (
		trimmed === "" ||
		trimmed === "<p></p>" ||
		trimmed === "<p><br></p>" ||
		trimmed === "<p><br /></p>"
	);
}
