/** Confluence's classic emoticon names and a palette for the emoji picker. */
export const classicEmoticons: Record<string, string> = {
	smile: "🙂",
	sad: "🙁",
	cheeky: "😛",
	laugh: "😄",
	wink: "😉",
	"thumbs-up": "👍",
	"thumbs-down": "👎",
	information: "ℹ️",
	tick: "✅",
	cross: "❌",
	warning: "⚠️",
	plus: "➕",
	minus: "➖",
	question: "❓",
	"light-on": "💡",
	"light-off": "🔌",
	"yellow-star": "⭐",
	"red-star": "🌟",
	"green-star": "🟢",
	"blue-star": "🔵",
};

export type EmojiEntry = { name: string; char: string; id: string };

const palette: [string, string][] = [
	["grinning face", "😀"],
	["smiling face with smiling eyes", "😊"],
	["face with tears of joy", "😂"],
	["winking face", "😉"],
	["thinking face", "🤔"],
	["slightly frowning face", "🙁"],
	["party popper", "🎉"],
	["thumbs up", "👍"],
	["thumbs down", "👎"],
	["clapping hands", "👏"],
	["folded hands", "🙏"],
	["waving hand", "👋"],
	["red heart", "❤️"],
	["fire", "🔥"],
	["sparkles", "✨"],
	["rocket", "🚀"],
	["check mark button", "✅"],
	["cross mark", "❌"],
	["warning", "⚠️"],
	["light bulb", "💡"],
	["eyes", "👀"],
	["memo", "📝"],
	["pushpin", "📌"],
	["bug", "🐛"],
	["green square", "🟩"],
	["red square", "🟥"],
	["yellow square", "🟨"],
	["blue square", "🟦"],
	["black large square", "⬛"],
	["star", "⭐"],
];

export const emojiPalette: EmojiEntry[] = palette.map(([name, char]) => ({
	name,
	char,
	id: [...char]
		.map((c) => (c.codePointAt(0) ?? 0).toString(16))
		.filter((hex) => hex !== "fe0f")
		.join("-"),
}));

export function emoticonChar(attrs: {
	name?: unknown;
	emojiFallback?: unknown;
}): string {
	if (typeof attrs.emojiFallback === "string" && attrs.emojiFallback !== "") {
		return attrs.emojiFallback;
	}
	const name = typeof attrs.name === "string" ? attrs.name : "";
	return (
		classicEmoticons[name] ??
		emojiPalette.find((entry) => entry.name === name)?.char ??
		`:${name}:`
	);
}
