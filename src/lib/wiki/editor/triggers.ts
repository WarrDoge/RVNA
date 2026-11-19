import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type TriggerKind = "mention" | "slash" | "emoji";

export type KeyHandler = (event: KeyboardEvent) => boolean;

export type TriggerMatch = {
	kind: TriggerKind;
	query: string;
	/** document range of the trigger character and the text typed after it */
	from: number;
	to: number;
};

/** Which popup the text just before the cursor asks for; `length` covers the trigger and its query. */
export function matchTrigger(
	textBefore: string,
): { kind: TriggerKind; query: string; length: number } | null {
	const mention = /(?:^|\s)@([^\s@]{0,40})$/.exec(textBefore);
	if (mention) {
		return {
			kind: "mention",
			query: mention[1],
			length: mention[1].length + 1,
		};
	}
	const slash = /(?:^|\s)\/([^\s/]{0,30})$/.exec(textBefore);
	if (slash) {
		return { kind: "slash", query: slash[1], length: slash[1].length + 1 };
	}
	const emoji = /(?:^|\s):([a-z0-9_+-]{2,30})$/i.exec(textBefore);
	if (emoji) {
		return { kind: "emoji", query: emoji[1], length: emoji[1].length + 1 };
	}
	return null;
}

export type TriggerHost = {
	onMatch: (match: TriggerMatch | null, view: EditorView) => void;
	/** keys typed while a popup is open; return true when the popup handled the key */
	onKey: (event: KeyboardEvent) => boolean;
	openLink: () => void;
	openMacros: () => void;
};

const key = new PluginKey("wikiTriggers");

function currentMatch(view: EditorView): TriggerMatch | null {
	const { selection } = view.state;
	if (!selection.empty || !view.editable || !view.hasFocus()) return null;
	const { $from } = selection;
	if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;
	const before = $from.parent.textBetween(
		Math.max(0, $from.parentOffset - 60),
		$from.parentOffset,
		undefined,
		"￼",
	);
	const found = matchTrigger(before);
	if (!found) return null;
	return {
		kind: found.kind,
		query: found.query,
		from: selection.from - found.length,
		to: selection.from,
	};
}

/**
 * `@`, `/` and `:xx` open popups through the host, `[` opens the link dialog and `{` the macro
 * browser without typing the character.
 */
export function triggerPlugin(host: TriggerHost): Plugin {
	let shown: TriggerMatch | null = null;
	let dismissedAt: number | null = null;

	const publish = (view: EditorView) => {
		let next = currentMatch(view);
		if (next && next.from === dismissedAt) next = null;
		if (!next) dismissedAt = null;
		if (
			next?.kind === shown?.kind &&
			next?.query === shown?.query &&
			next?.from === shown?.from
		) {
			return;
		}
		shown = next;
		host.onMatch(next, view);
	};

	return new Plugin({
		key,
		view: () => ({
			update: publish,
			destroy() {
				shown = null;
			},
		}),
		props: {
			handleKeyDown(view, event) {
				if (!shown) return false;
				if (event.key === "Escape") {
					dismissedAt = shown.from;
					shown = null;
					host.onMatch(null, view);
					return true;
				}
				return host.onKey(event);
			},
			handleTextInput(view, _from, _to, text) {
				if (text !== "[" && text !== "{") return false;
				if (
					!view.editable ||
					view.state.selection.$from.parent.type.spec.code
				) {
					return false;
				}
				if (text === "[") host.openLink();
				else host.openMacros();
				return true;
			},
			handleDOMEvents: {
				blur(view) {
					if (shown) {
						shown = null;
						host.onMatch(null, view);
					}
					return false;
				},
			},
		},
	});
}
