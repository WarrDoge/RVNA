<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Button from "#lib/components/Button.svelte";
	import {
		ANY,
		LABEL_CHAR,
		layoutWorkflow,
		MAX_NODE_CHARS,
		NODE_HEIGHT,
		type DiagramEdge,
		type DiagramNode,
		type Pt,
	} from "#lib/workflow/diagram.ts";
	import type { WorkflowDetail } from "#lib/workflow/types.ts";

	interface Props {
		detail: Pick<
			WorkflowDetail,
			"statuses" | "transitions" | "initialStatusId"
		>;
		selectedStatusId?: string | null;
		selectedTransitionId?: string | null;
		onSelectStatus?: (id: string) => void;
		onSelectTransition?: (id: string) => void;
	}

	let {
		detail,
		selectedStatusId,
		selectedTransitionId,
		onSelectStatus,
		onSelectTransition,
	}: Props = $props();

	type View = { x: number; y: number; k: number };
	const MIN_ZOOM = 0.2;
	const MAX_ZOOM = 3;
	const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

	const layout = $derived(layoutWorkflow(detail));
	const selectable = $derived(
		onSelectStatus !== undefined ||
			onSelectTransition !== undefined ||
			selectedStatusId !== undefined ||
			selectedTransitionId !== undefined,
	);

	let frame = $state<HTMLDivElement | null>(null);
	let view = $state<View>({ x: 0, y: 0, k: 1 });
	let hover = $state<string | null>(null);
	let dragging = $state(false);
	let internalStatus = $state<string | null>(null);
	let internalTransition = $state<string | null>(null);
	let drag: { x: number; y: number; origin: View } | null = null;
	let fitted = false;
	let press: {
		x: number;
		y: number;
		moved: boolean;
		status: string | null;
		transition: string | null;
	} | null = null;

	const activeStatus = $derived(
		selectedStatusId !== undefined ? selectedStatusId : internalStatus,
	);
	const activeTransition = $derived(
		selectedTransitionId !== undefined
			? selectedTransitionId
			: internalTransition,
	);

	const related = $derived.by(() => {
		const set = new Set<string>();
		if (hover === null) return set;
		set.add(hover);
		for (const edge of layout.edges) {
			if (edge.from === hover) set.add(edge.to);
			if (edge.to === hover) set.add(edge.from);
		}
		return set;
	});

	function fitView() {
		const element = frame;
		if (!element || layout.nodes.length === 0) return;
		const { minX, minY, maxX, maxY } = layout.bounds;
		const margin = 36;
		const width = maxX - minX + margin * 2;
		const height = maxY - minY + margin * 2;
		const k = clampZoom(
			Math.min(element.clientWidth / width, element.clientHeight / height, 1.4),
		);
		view = {
			k,
			x: (element.clientWidth - (maxX - minX) * k) / 2 - minX * k,
			y: (element.clientHeight - (maxY - minY) * k) / 2 - minY * k,
		};
	}

	$effect(() => {
		const current = layout;
		if (fitted || current.nodes.length === 0) return;
		fitted = true;
		fitView();
	});

	function zoomAt(factor: number, at?: Pt) {
		const element = frame;
		if (!element) return;
		const origin = at ?? {
			x: element.clientWidth / 2,
			y: element.clientHeight / 2,
		};
		const k = clampZoom(view.k * factor);
		const ratio = k / view.k;
		view = {
			k,
			x: origin.x - (origin.x - view.x) * ratio,
			y: origin.y - (origin.y - view.y) * ratio,
		};
	}

	function wheelZoom(element: HTMLElement) {
		function onWheel(event: WheelEvent) {
			event.preventDefault();
			const rect = element.getBoundingClientRect();
			zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			});
		}
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		drag = { x: event.clientX, y: event.clientY, origin: view };
		const target = event.target as Element;
		press = selectable
			? {
					x: event.clientX,
					y: event.clientY,
					moved: false,
					status:
						target
							.closest("[data-status-id]")
							?.getAttribute("data-status-id") ?? null,
					transition:
						target
							.closest("[data-transition-id]")
							?.getAttribute("data-transition-id") ?? null,
				}
			: null;
		dragging = true;
		(event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent) {
		const start = drag;
		if (!start) return;
		if (
			press &&
			Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4
		) {
			press.moved = true;
		}
		view = {
			...start.origin,
			x: start.origin.x + event.clientX - start.x,
			y: start.origin.y + event.clientY - start.y,
		};
	}

	function finishPointer(select: boolean) {
		const pressed = press;
		press = null;
		drag = null;
		dragging = false;
		if (!select || !pressed || pressed.moved) return;
		if (pressed.status !== null) {
			if (selectedStatusId === undefined) {
				internalStatus = pressed.status;
				internalTransition = null;
			}
			onSelectStatus?.(pressed.status);
		} else if (pressed.transition !== null) {
			if (selectedTransitionId === undefined) {
				internalTransition = pressed.transition;
				internalStatus = null;
			}
			onSelectTransition?.(pressed.transition);
		}
	}

	function touching(edge: { from: string; to: string }) {
		return hover !== null && (edge.from === hover || edge.to === hover);
	}

	function edgeActive(edge: DiagramEdge) {
		return touching(edge) || edge.id === activeTransition;
	}

	function edgeDim(edge: DiagramEdge) {
		return hover !== null && !edgeActive(edge);
	}

	function nodeSelected(node: DiagramNode) {
		return node.id === activeStatus;
	}

	function nodeDim(node: DiagramNode) {
		return hover !== null && !related.has(node.id);
	}

	function colours(category: "new" | "indeterminate" | "done" | "any") {
		switch (category) {
			case "done":
				return {
					fill: token("color.background.success.bold"),
					text: token("color.text.inverse"),
				};
			case "indeterminate":
				return {
					fill: token("color.background.information.bold"),
					text: token("color.text.inverse"),
				};
			case "any":
				return { fill: "none", text: token("color.text.subtle") };
			default:
				return {
					fill: token("color.background.neutral.bold"),
					text: token("color.text.inverse"),
				};
		}
	}

	function nodeText(label: string) {
		return label.length > MAX_NODE_CHARS
			? `${label.slice(0, MAX_NODE_CHARS - 1)}...`
			: label;
	}

	function shownLabel(text: string) {
		return text.length > 34 ? `${text.slice(0, 33)}...` : text;
	}

	function labelWidth(text: string) {
		return shownLabel(text).length * LABEL_CHAR + 10;
	}

	const legendItems: { label: string; fill: string }[] = [
		{ label: "To Do", fill: token("color.background.neutral.bold") },
		{ label: "In Progress", fill: token("color.background.information.bold") },
		{ label: "Done", fill: token("color.background.success.bold") },
	];
</script>

{#snippet edgeLabel(text: string, at: Pt, active: boolean)}
	{#if text !== ""}
		<g>
			<rect
				x={at.x - labelWidth(text) / 2}
				y={at.y - 8}
				width={labelWidth(text)}
				height={16}
				rx={3}
				fill={token("elevation.surface.sunken")}
				fill-opacity="0.92"
			/>
			<text
				x={at.x}
				y={at.y}
				text-anchor="middle"
				dominant-baseline="central"
				font-size="11"
				fill={active ? token("color.text") : token("color.text.subtle")}
			>
				<title>{text}</title>{shownLabel(text)}
			</text>
		</g>
	{/if}
{/snippet}

<div>
	<div class="toolbar">
		<Button onclick={() => zoomAt(1.25)} aria-label="Zoom in">+</Button>
		<Button onclick={() => zoomAt(1 / 1.25)} aria-label="Zoom out">-</Button>
		<Button onclick={fitView}>Fit</Button>
		<span class="hint">
			Drag to pan, scroll to zoom. Hover a status to follow its transitions.
		</span>
	</div>
	<div
		class="frame"
		class:grabbing={dragging}
		bind:this={frame}
		{@attach wheelZoom}
	>
		<svg
			width="100%"
			height="100%"
			role="img"
			aria-label="Workflow diagram"
			class="diagram"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={() => finishPointer(true)}
			onpointercancel={() => finishPointer(false)}
		>
			<defs>
				<marker
					id="wf-arrow"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill={token("color.border.bold")} />
				</marker>
				<marker
					id="wf-arrow-active"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M0,0 L10,5 L0,10 z" fill={token("color.link")} />
				</marker>
			</defs>
			<g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
				{#each layout.edges as edge (edge.id)}
					<g
						data-transition-id={edge.id}
						data-selected={edge.id === activeTransition ? "true" : undefined}
						opacity={edgeDim(edge) ? 0.12 : 1}
					>
						<path
							d={edge.path}
							fill="none"
							stroke={edgeActive(edge)
								? token("color.link")
								: token("color.border.bold")}
							stroke-width={edgeActive(edge) ? 2 : 1.2}
							stroke-dasharray={edge.from === ANY ? "5 4" : undefined}
							marker-end={`url(#${edgeActive(edge) ? "wf-arrow-active" : "wf-arrow"})`}
						/>
						{@render edgeLabel(edge.label, edge.labelAt, edgeActive(edge))}
					</g>
				{/each}
				{#each layout.nodes as node (node.id)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<g
						data-status-id={node.id}
						data-selected={nodeSelected(node) ? "true" : undefined}
						opacity={nodeDim(node) ? 0.25 : 1}
						onpointerenter={() => (hover = node.id)}
						onpointerleave={() => (hover = null)}
						style:cursor={selectable ? "pointer" : "default"}
					>
						<title>{node.label}</title>
						{#if node.initial}
							<g>
								<circle
									cx={node.x - node.width / 2 + 8}
									cy={node.y - NODE_HEIGHT / 2 - 32}
									r={5}
									fill={token("color.icon")}
								/>
								<line
									x1={node.x - node.width / 2 + 8}
									y1={node.y - NODE_HEIGHT / 2 - 27}
									x2={node.x - node.width / 2 + 8}
									y2={node.y - NODE_HEIGHT / 2 - 2}
									stroke={token("color.icon")}
									stroke-width="1.4"
									marker-end="url(#wf-arrow)"
								/>
							</g>
						{/if}
						<rect
							x={node.x - node.width / 2}
							y={node.y - NODE_HEIGHT / 2}
							width={node.width}
							height={NODE_HEIGHT}
							rx={4}
							fill={colours(node.category).fill}
							stroke={nodeSelected(node)
								? token("color.link")
								: node.category === "any"
									? token("color.border.bold")
									: node.id === hover
										? token("color.link")
										: "none"}
							stroke-width={nodeSelected(node) || node.id === hover ? 2 : 1}
							stroke-dasharray={node.category === "any" ? "5 4" : undefined}
						/>
						<text
							x={node.x}
							y={node.y}
							text-anchor="middle"
							dominant-baseline="central"
							font-size="11"
							font-weight="700"
							letter-spacing="0.3"
							fill={colours(node.category).text}
							style="text-transform: uppercase;"
						>
							{nodeText(node.label)}
						</text>
					</g>
				{/each}
			</g>
		</svg>
		<div class="legend">
			{#each legendItems as item (item.label)}
				<span class="legend-item"><span class="swatch" style:background-color={item.fill}></span>{item.label}</span>
			{/each}<span>Dashed: from any status</span>
		</div>
	</div>
</div>

<style>
	.diagram {
		display: block;
		user-select: none;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}

	.hint {
		color: var(--ds-text-subtle);
		font-size: 12px;
	}

	.frame {
		position: relative;
		height: max(420px, calc(100vh - 300px));
		overflow: hidden;
		border: 1px solid var(--ds-border);
		border-radius: 3px;
		background-color: var(--ds-surface-sunken);
		cursor: grab;
		touch-action: none;
	}

	.frame.grabbing {
		cursor: grabbing;
	}

	.legend {
		position: absolute;
		right: 12px;
		bottom: 10px;
		display: flex;
		gap: 12px;
		font-size: 11px;
		color: var(--ds-text-subtle);
		pointer-events: none;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
</style>
