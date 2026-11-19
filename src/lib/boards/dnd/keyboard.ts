import type { Attachment } from "svelte/attachments";

export type KeyboardDirection = "up" | "down" | "left" | "right";

export interface KeyboardDragOptions {
	getKeys: () => string[];
	isEnabled?: () => boolean;
	isActive: () => boolean;
	onLift: (keys: string[]) => void;
	onMove: (keys: string[], direction: KeyboardDirection) => void;
	onDrop: (keys: string[]) => void;
	onCancel: (keys: string[]) => void;
}

function directionFor(key: string): KeyboardDirection | null {
	if (key === "ArrowUp") return "up";
	if (key === "ArrowDown") return "down";
	if (key === "ArrowLeft") return "left";
	if (key === "ArrowRight") return "right";
	return null;
}

/**
 * Space lifts and drops a card; the arrow keys move it while lifted; Escape
 * restores the list. Enter keeps its normal button behaviour.
 */
export function keyboardDraggable(
	options: KeyboardDragOptions,
): Attachment<HTMLElement> {
	return (element) => {
		function onKeyDown(event: KeyboardEvent) {
			if (options.isEnabled && !options.isEnabled()) return;
			const active = options.isActive();
			if (event.key === " " || event.code === "Space") {
				event.preventDefault();
				if (active) options.onDrop(options.getKeys());
				else options.onLift(options.getKeys());
				return;
			}
			if (!active) return;
			if (event.key === "Enter") {
				event.preventDefault();
				options.onDrop(options.getKeys());
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				options.onCancel(options.getKeys());
				return;
			}
			const direction = directionFor(event.key);
			if (!direction) return;
			event.preventDefault();
			options.onMove(options.getKeys(), direction);
		}

		element.addEventListener("keydown", onKeyDown);
		return () => element.removeEventListener("keydown", onKeyDown);
	};
}
