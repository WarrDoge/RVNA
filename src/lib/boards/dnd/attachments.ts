import {
	draggable,
	dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { Attachment } from "svelte/attachments";
import type { BoardIssue } from "#lib/api-types.ts";

let lastDropAt = 0;

/** Nested targets fire in order; only the innermost drop should move issues. */
export function claimDrop() {
	const now = Date.now();
	if (now - lastDropAt < 150) return false;
	lastDropAt = now;
	return true;
}

export function resetDropGuard() {
	lastDropAt = 0;
}

export type DropKind = "board-column" | "board-status";

type PreviewArgs = {
	nativeSetDragImage: DataTransfer["setDragImage"] | null;
	issue: BoardIssue;
};

export interface BoardCardDragOptions {
	getIssue: () => BoardIssue;
	onDragStart: () => void;
	onDragEnd: () => void;
	onGenerateDragPreview?: (args: PreviewArgs) => void;
}

export function boardCardDrag(
	options: BoardCardDragOptions,
): Attachment<HTMLElement> {
	return (element) => {
		const cleanup = draggable({
			element,
			getInitialData: () => {
				const issue = options.getIssue();
				return {
					type: "board-issue",
					issueKeys: [issue.key],
					columnId: issue.columnId,
				};
			},
			...(options.onGenerateDragPreview
				? {
						onGenerateDragPreview: ({
							nativeSetDragImage,
						}: {
							nativeSetDragImage: DataTransfer["setDragImage"] | null;
						}) => {
							options.onGenerateDragPreview?.({
								nativeSetDragImage,
								issue: options.getIssue(),
							});
						},
					}
				: {}),
			onDragStart: () => {
				resetDropGuard();
				options.onDragStart();
			},
			onDrop: () => {
				options.onDragEnd();
			},
		});
		return cleanup;
	};
}

export interface StatusDragOptions {
	getStatusId: () => string;
	isEnabled?: () => boolean;
	onDragStart?: () => void;
	onDragEnd?: () => void;
}

/** A status chip dragged between board configuration columns. */
export function statusDrag(
	options: StatusDragOptions,
): Attachment<HTMLElement> {
	return (element) => {
		const cleanup = draggable({
			element,
			canDrag: () => options.isEnabled?.() ?? true,
			getInitialData: () => ({
				type: "board-status",
				issueKeys: [options.getStatusId()],
			}),
			onDragStart: () => {
				resetDropGuard();
				options.onDragStart?.();
			},
			onDrop: () => {
				options.onDragEnd?.();
			},
		});
		return cleanup;
	};
}

export interface BoardCardDropTargetOptions {
	getIssue: () => BoardIssue;
	onOverChange: (over: boolean) => void;
	onDropBefore: (keys: string[]) => void;
}

export function boardCardDropTarget(
	options: BoardCardDropTargetOptions,
): Attachment<HTMLElement> {
	return (element) =>
		dropTargetForElements({
			element,
			getData: () => {
				const issue = options.getIssue();
				return {
					type: "board-card",
					key: issue.key,
					columnId: issue.columnId,
				};
			},
			canDrop: ({ source }) =>
				source.data.type === "board-issue" &&
				!(source.data.issueKeys as string[]).includes(options.getIssue().key),
			onDragEnter: () => options.onOverChange(true),
			onDragLeave: () => options.onOverChange(false),
			onDrop: ({ source }) => {
				options.onOverChange(false);
				if (!claimDrop()) return;
				options.onDropBefore(source.data.issueKeys as string[]);
			},
		});
}

export interface BacklogRowDragOptions {
	getIssue: () => BoardIssue;
	getDragKeys: () => string[];
	onDragStart: () => void;
	onDragEnd: () => void;
	onGenerateDragPreview?: (args: PreviewArgs) => void;
}

export function backlogRowDrag(
	options: BacklogRowDragOptions,
): Attachment<HTMLElement> {
	return (element) => {
		const cleanup = draggable({
			element,
			getInitialData: () => {
				const issue = options.getIssue();
				return {
					type: "backlog-issue",
					issueKeys: options.getDragKeys(),
					sprintId: issue.sprintId,
				};
			},
			...(options.onGenerateDragPreview
				? {
						onGenerateDragPreview: ({
							nativeSetDragImage,
						}: {
							nativeSetDragImage: DataTransfer["setDragImage"] | null;
						}) => {
							options.onGenerateDragPreview?.({
								nativeSetDragImage,
								issue: options.getIssue(),
							});
						},
					}
				: {}),
			onDragStart: () => {
				resetDropGuard();
				options.onDragStart();
			},
			onDrop: () => {
				options.onDragEnd();
			},
		});
		return cleanup;
	};
}

export interface BacklogRowDropTargetOptions {
	getIssue: () => BoardIssue;
	onOverChange: (over: boolean) => void;
	onDropBefore: (keys: string[]) => void;
}

export function backlogRowDropTarget(
	options: BacklogRowDropTargetOptions,
): Attachment<HTMLElement> {
	return (element) =>
		dropTargetForElements({
			element,
			getData: () => {
				const issue = options.getIssue();
				return {
					type: "backlog-row",
					key: issue.key,
					sprintId: issue.sprintId,
				};
			},
			canDrop: ({ source }) =>
				(source.data.type === "backlog-issue" ||
					source.data.type === "board-issue") &&
				!(source.data.issueKeys as string[]).includes(options.getIssue().key),
			onDragEnter: () => options.onOverChange(true),
			onDragLeave: () => options.onOverChange(false),
			onDrop: ({ source }) => {
				options.onOverChange(false);
				if (!claimDrop()) return;
				options.onDropBefore(source.data.issueKeys as string[]);
			},
		});
}

export interface DropZoneOptions {
	getKind: () => DropKind;
	getColumnId: () => string | undefined;
	getStatusId: () => string | undefined;
	getAccept: () => string[];
	onOverChange: (over: boolean) => void;
	onDrop: (keys: string[]) => void;
}

export function dropZone(options: DropZoneOptions): Attachment<HTMLElement> {
	return (element) =>
		dropTargetForElements({
			element,
			getData: () => ({
				type: options.getKind(),
				columnId: options.getColumnId(),
				statusId: options.getStatusId(),
			}),
			canDrop: ({ source }) =>
				options.getAccept().includes(String(source.data.type)),
			onDragEnter: () => options.onOverChange(true),
			onDragLeave: () => options.onOverChange(false),
			onDrop: ({ source }) => {
				options.onOverChange(false);
				if (!claimDrop()) return;
				options.onDrop(source.data.issueKeys as string[]);
			},
		});
}
