import type { Attachment } from "svelte/attachments";

function move<T>(items: T[], from: number, to: number) {
	const next = [...items];
	const [item] = next.splice(from, 1);
	if (item === undefined) return items;
	next.splice(to, 0, item);
	return next;
}

/**
 * Drag-to-reorder for table rows or list items. `onChange` receives the new
 * order; the caller saves it. Each row also gets keyboard-reachable up and
 * down buttons through `<MoveButtons>` so reordering works without a mouse.
 *
 *   const sortable = createSortable(() => rows, (next) => (rows = next));
 *   <tr {@attach sortable.row(index)}> ...
 *   <MoveButtons index={index} count={rows.length}
 *     onMove={(delta) => sortable.moveBy(index, delta)} label={...} />
 */
export function createSortable<T>(
	items: () => T[],
	onChange: (next: T[]) => void,
) {
	let dragging = $state<number | null>(null);
	let over = $state<number | null>(null);

	return {
		get dragging() {
			return dragging;
		},
		get over() {
			return over;
		},
		moveBy(index: number, delta: -1 | 1) {
			const target = index + delta;
			const current = items();
			if (target < 0 || target >= current.length) return;
			onChange(move(current, index, target));
		},
		row(index: number): Attachment<HTMLElement> {
			return (node) => {
				node.draggable = true;

				const onDragStart = (event: DragEvent) => {
					if (event.dataTransfer) {
						event.dataTransfer.effectAllowed = "move";
					}
					dragging = index;
				};
				const onDragOver = (event: DragEvent) => {
					if (dragging === null) return;
					event.preventDefault();
					over = index;
				};
				const onDrop = (event: DragEvent) => {
					event.preventDefault();
					if (dragging !== null && dragging !== index) {
						onChange(move(items(), dragging, index));
					}
					dragging = null;
					over = null;
				};
				const onDragEnd = () => {
					dragging = null;
					over = null;
				};

				node.addEventListener("dragstart", onDragStart);
				node.addEventListener("dragover", onDragOver);
				node.addEventListener("drop", onDrop);
				node.addEventListener("dragend", onDragEnd);

				$effect(() => {
					const isDragging = dragging === index;
					const isOver =
						over === index && dragging !== null && dragging !== index;
					if (isOver) {
						node.setAttribute("data-drop-target", "true");
					} else {
						node.removeAttribute("data-drop-target");
					}
					node.style.opacity = isDragging ? "0.5" : "1";
					node.style.boxShadow = isOver
						? "inset 0 2px 0 var(--ds-border-selected)"
						: "";
				});

				return () => {
					node.removeEventListener("dragstart", onDragStart);
					node.removeEventListener("dragover", onDragOver);
					node.removeEventListener("drop", onDrop);
					node.removeEventListener("dragend", onDragEnd);
					node.removeAttribute("data-drop-target");
					node.style.opacity = "";
					node.style.boxShadow = "";
				};
			};
		},
	};
}
