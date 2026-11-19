import type { WorkflowDetail } from "./types.ts";

export const ANY = "__any__";
export const NODE_HEIGHT = 28;
export const ROW_GAP = 60;
export const MIN_COLUMN_GAP = 120;
export const LABEL_CHAR = 6;
export const MAX_NODE_CHARS = 30;

export type Pt = { x: number; y: number };

export type DiagramNode = {
	id: string;
	label: string;
	category: "new" | "indeterminate" | "done" | "any";
	initial: boolean;
	x: number;
	y: number;
	width: number;
	column: number;
};

export type DiagramEdge = {
	id: string;
	from: string;
	to: string;
	label: string;
	path: string;
	end: Pt;
	labelAt: Pt;
};

export type DiagramLayout = {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

type Edge = { id: string; from: string; to: string; label: string };

export const nodeWidth = (label: string) =>
	Math.max(76, Math.min(label.length, MAX_NODE_CHARS) * 7.4 + 22);

export function bezierPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
	const u = 1 - t;
	return {
		x:
			u ** 3 * p0.x +
			3 * u * u * t * p1.x +
			3 * u * t * t * p2.x +
			t ** 3 * p3.x,
		y:
			u ** 3 * p0.y +
			3 * u * u * t * p1.y +
			3 * u * t * t * p2.y +
			t ** 3 * p3.y,
	};
}

/** Layer of every node: shortest distance from the initial status; nodes only an any-status edge reaches follow the initial status; the rest go last. */
function assignLayers(
	ids: string[],
	edges: Edge[],
	initial: string | null,
): Map<string, number> {
	const layer = new Map<string, number>();
	const out = new Map<string, string[]>();
	for (const edge of edges) {
		if (edge.from === ANY) continue;
		out.set(edge.from, [...(out.get(edge.from) ?? []), edge.to]);
	}
	const spread = (seeds: string[], start: number) => {
		let frontier = seeds;
		let depth = start;
		while (frontier.length > 0) {
			const next: string[] = [];
			for (const id of frontier) {
				for (const target of out.get(id) ?? []) {
					if (layer.has(target)) continue;
					layer.set(target, depth + 1);
					next.push(target);
				}
			}
			frontier = next;
			depth++;
		}
	};

	const first = initial && ids.includes(initial) ? initial : (ids[0] ?? null);
	if (first) {
		layer.set(first, 0);
		spread([first], 0);
	}
	const viaAny = edges
		.filter((edge) => edge.from === ANY && !layer.has(edge.to))
		.map((edge) => edge.to);
	const seeds = [...new Set(viaAny)];
	for (const id of seeds) layer.set(id, first ? 1 : 0);
	spread(seeds, first ? 1 : 0);

	const last = Math.max(-1, ...layer.values()) + 1;
	const stranded = ids.filter((id) => !layer.has(id));
	for (const id of stranded) layer.set(id, last);
	return layer;
}

export function layoutWorkflow(
	detail: Pick<WorkflowDetail, "statuses" | "transitions" | "initialStatusId">,
): DiagramLayout {
	const known = new Set(detail.statuses.map((status) => status.id));
	const hasAny = detail.transitions.some(
		(transition) => transition.fromStatusId === null,
	);
	const edges: Edge[] = detail.transitions
		.filter((transition) => known.has(transition.toStatusId))
		.map((transition) => ({
			id: transition.id,
			from: transition.fromStatusId ?? ANY,
			to: transition.toStatusId,
			label: transition.name,
		}))
		.filter((edge) => edge.from === ANY || known.has(edge.from));

	const statusIds = detail.statuses.map((status) => status.id);
	const layers = assignLayers(statusIds, edges, detail.initialStatusId);
	const shift = hasAny ? 1 : 0;
	const columnOf = (id: string) =>
		id === ANY ? 0 : (layers.get(id) ?? 0) + shift;

	const columnCount = Math.max(0, ...statusIds.map(columnOf)) + 1;
	const columns: string[][] = Array.from({ length: columnCount }, () => []);
	if (hasAny) columns[0].push(ANY);
	for (const id of statusIds) columns[columnOf(id)].push(id);

	const neighbours = new Map<string, Set<string>>();
	for (const edge of edges) {
		if (edge.from === edge.to) continue;
		for (const [a, b] of [
			[edge.from, edge.to],
			[edge.to, edge.from],
		] as const) {
			const set = neighbours.get(a) ?? new Set();
			set.add(b);
			neighbours.set(a, set);
		}
	}
	const position = new Map<string, number>();
	const index = () => {
		for (const column of columns) {
			column.forEach((id, row) => {
				position.set(id, row);
			});
		}
	};
	index();
	const sweep = (order: number[]) => {
		for (const c of order) {
			const barycenter = (id: string) => {
				const near = [...(neighbours.get(id) ?? [])].filter(
					(other) => columnOf(other) !== c,
				);
				if (near.length === 0) return position.get(id) ?? 0;
				return (
					near.reduce((sum, other) => sum + (position.get(other) ?? 0), 0) /
					near.length
				);
			};
			columns[c] = columns[c]
				.map((id, row) => ({ id, value: barycenter(id), row }))
				.sort((a, b) => a.value - b.value || a.row - b.row)
				.map((item) => item.id);
			index();
		}
	};
	const forward = columns.map((_, c) => c);
	for (let pass = 0; pass < 4; pass++) {
		sweep(forward);
		sweep([...forward].reverse());
	}

	const label = (id: string) =>
		id === ANY
			? "Any status"
			: (detail.statuses.find((status) => status.id === id)?.name ?? "");
	const widthOf = new Map<string, number>(
		[ANY, ...statusIds].map((id) => [id, nodeWidth(label(id))]),
	);

	const edgeLabelWidth = (column: number) => {
		let widest = 0;
		for (const edge of edges) {
			if (edge.label.length === 0) continue;
			const from = columnOf(edge.from);
			const to = columnOf(edge.to);
			if (Math.min(from, to) === column && Math.abs(from - to) === 1) {
				widest = Math.max(widest, edge.label.length * LABEL_CHAR + 16);
			}
		}
		return widest;
	};

	const columnX: number[] = [];
	const columnWidth = columns.map((ids) =>
		Math.max(0, ...ids.map((id) => widthOf.get(id) ?? 0)),
	);
	let cursor = 0;
	columns.forEach((_, c) => {
		columnX[c] = cursor + columnWidth[c] / 2;
		cursor += columnWidth[c] + Math.max(MIN_COLUMN_GAP, edgeLabelWidth(c) + 56);
	});

	const tallest = Math.max(1, ...columns.map((ids) => ids.length));
	const height = tallest * (NODE_HEIGHT + ROW_GAP);
	const nodes = new Map<string, DiagramNode>();
	columns.forEach((ids, c) => {
		const span = ids.length * (NODE_HEIGHT + ROW_GAP);
		const top = (height - span) / 2;
		ids.forEach((id, row) => {
			const status = detail.statuses.find((item) => item.id === id);
			nodes.set(id, {
				id,
				label: label(id),
				category: id === ANY ? "any" : (status?.category ?? "new"),
				initial: id === detail.initialStatusId,
				x: columnX[c],
				y: top + row * (NODE_HEIGHT + ROW_GAP) + (NODE_HEIGHT + ROW_GAP) / 2,
				width: widthOf.get(id) ?? 80,
				column: c,
			});
		});
	});

	const bounds = {
		minX: Number.POSITIVE_INFINITY,
		minY: Number.POSITIVE_INFINITY,
		maxX: Number.NEGATIVE_INFINITY,
		maxY: Number.NEGATIVE_INFINITY,
	};
	const extend = (point: Pt) => {
		bounds.minX = Math.min(bounds.minX, point.x);
		bounds.maxX = Math.max(bounds.maxX, point.x);
		bounds.minY = Math.min(bounds.minY, point.y);
		bounds.maxY = Math.max(bounds.maxY, point.y);
	};
	for (const node of nodes.values()) {
		extend({
			x: node.x - node.width / 2,
			y: node.y - NODE_HEIGHT / 2 - (node.initial ? 40 : 0),
		});
		extend({ x: node.x + node.width / 2, y: node.y + NODE_HEIGHT / 2 });
	}

	const pairCount = new Map<string, number>();
	const pairSeen = new Map<string, number>();
	const pairKey = (edge: Edge) => `${edge.from}>${edge.to}`;
	for (const edge of edges) {
		pairCount.set(pairKey(edge), (pairCount.get(pairKey(edge)) ?? 0) + 1);
	}
	let above = 0;
	let below = 0;
	const drawn: DiagramEdge[] = [];
	const curves = new Map<string, [Pt, Pt, Pt, Pt]>();
	const spanOf = (edge: Edge) =>
		(nodes.get(edge.to)?.column ?? 0) - (nodes.get(edge.from)?.column ?? 0);
	const isArc = (edge: Edge) => spanOf(edge) >= 2 || spanOf(edge) < 0;
	const ordered = [...edges].sort(
		(a, b) =>
			Number(isArc(a)) - Number(isArc(b)) ||
			Math.abs(spanOf(a)) - Math.abs(spanOf(b)),
	);
	for (const edge of ordered) {
		const from = nodes.get(edge.from);
		const to = nodes.get(edge.to);
		if (!from || !to) continue;
		const n = pairCount.get(pairKey(edge)) ?? 1;
		const k = pairSeen.get(pairKey(edge)) ?? 0;
		pairSeen.set(pairKey(edge), k + 1);
		const spreadY = (k - (n - 1) / 2) * 9;

		let path: string;
		let end: Pt;
		let labelAt: Pt;
		let curve: [Pt, Pt, Pt, Pt];
		if (to.column - from.column === 1) {
			const p0 = { x: from.x + from.width / 2, y: from.y + spreadY };
			const p3 = { x: to.x - to.width / 2 - 2, y: to.y + spreadY };
			const bend = Math.max(40, (p3.x - p0.x) / 2);
			const p1 = { x: p0.x + bend, y: p0.y };
			const p2 = { x: p3.x - bend, y: p3.y };
			path = `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
			end = p3;
			curve = [p0, p1, p2, p3];
			labelAt = bezierPoint(p0, p1, p2, p3, 0.5);
			extend(labelAt);
		} else if (to.column === from.column) {
			const side = k % 2 === 0 ? 1 : -1;
			const x0 = from.x + (side * from.width) / 2;
			const x1 = to.x + (side * to.width) / 2 + side * 2;
			const reach =
				34 + Math.abs(to.y - from.y) * 0.12 + Math.floor(k / 2) * 14;
			const p0 = { x: x0, y: from.y };
			const p3 = { x: x1, y: to.y };
			const p1 = { x: x0 + side * reach, y: from.y };
			const p2 = { x: x1 + side * reach, y: to.y };
			path = `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
			end = p3;
			curve = [p0, p1, p2, p3];
			labelAt = bezierPoint(p0, p1, p2, p3, 0.5);
			extend(labelAt);
			extend({ x: labelAt.x + side * 30, y: labelAt.y });
		} else {
			const useAbove = above <= below;
			if (useAbove) above++;
			else below++;
			const dir = useAbove ? -1 : 1;
			const sign = to.column > from.column ? 1 : -1;
			const lift = 26 + (useAbove ? above : below) * 14;
			const p0 = {
				x: from.x + (sign * from.width) / 4,
				y: from.y + dir * (NODE_HEIGHT / 2),
			};
			const p3 = {
				x: to.x - (sign * to.width) / 4,
				y: to.y + dir * (NODE_HEIGHT / 2 + 2),
			};
			const edgeY = dir < 0 ? Math.min(p0.y, p3.y) : Math.max(p0.y, p3.y);
			const p1 = { x: p0.x + sign * 20, y: edgeY + dir * lift };
			const p2 = { x: p3.x - sign * 20, y: edgeY + dir * lift };
			path = `M${p0.x},${p0.y} C${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
			end = p3;
			curve = [p0, p1, p2, p3];
			labelAt = bezierPoint(p0, p1, p2, p3, 0.5);
			extend(labelAt);
			extend({ x: labelAt.x, y: labelAt.y + dir * 8 });
		}
		curves.set(edge.id, curve);
		drawn.push({
			id: edge.id,
			from: edge.from,
			to: edge.to,
			label: edge.label,
			path,
			end,
			labelAt,
		});
	}

	const taken: { x: number; y: number; w: number; h: number }[] = [];
	for (const node of nodes.values()) {
		taken.push({
			x: node.x - node.width / 2 - 3,
			y: node.y - NODE_HEIGHT / 2 - 3,
			w: node.width + 6,
			h: NODE_HEIGHT + 6,
		});
	}
	const hits = (rect: { x: number; y: number; w: number; h: number }) =>
		taken.some(
			(other) =>
				rect.x < other.x + other.w &&
				rect.x + rect.w > other.x &&
				rect.y < other.y + other.h &&
				rect.y + rect.h > other.y,
		);
	for (const edge of drawn) {
		const curve = curves.get(edge.id);
		if (!curve || edge.label === "") continue;
		const width = Math.min(edge.label.length, 34) * LABEL_CHAR + 10;
		let chosen = edge.labelAt;
		for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) {
			const at = bezierPoint(curve[0], curve[1], curve[2], curve[3], t);
			const rect = { x: at.x - width / 2, y: at.y - 8, w: width, h: 16 };
			if (!hits(rect)) {
				chosen = at;
				taken.push(rect);
				break;
			}
		}
		if (chosen === edge.labelAt) {
			taken.push({
				x: chosen.x - width / 2,
				y: chosen.y - 8,
				w: width,
				h: 16,
			});
		}
		edge.labelAt = chosen;
		extend({ x: chosen.x - width / 2, y: chosen.y - 8 });
		extend({ x: chosen.x + width / 2, y: chosen.y + 8 });
	}

	if (!Number.isFinite(bounds.minX)) {
		return {
			nodes: [],
			edges: [],
			bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
		};
	}
	return { nodes: [...nodes.values()], edges: drawn, bounds };
}
