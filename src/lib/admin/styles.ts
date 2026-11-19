/**
 * The two control styles the administration screens share as
 * `inputStyle` and `textareaStyle`, for the raw inputs a screen still writes
 * itself. Components in this directory apply the same declarations in their
 * scoped styles.
 */
export const inputStyle =
	"width: 100%; height: 32px; padding: 0 8px; background-color: var(--ds-background-input); border: 1px solid var(--ds-border-input); border-radius: 3px; color: var(--ds-text); font-size: 14px;";

export const textareaStyle = `${inputStyle} height: auto; min-height: 72px; padding: 6px 8px; resize: vertical;`;
