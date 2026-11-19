import { describe, expect, test } from "vitest";
import {
	ANY,
	bezierPoint,
	layoutWorkflow,
	nodeWidth,
} from "../src/lib/workflow/diagram.ts";
import { workflowGallery } from "../src/lib/workflow/gallery.ts";
import type { WorkflowDetail } from "../src/lib/workflow/types.ts";

const detail = (
	statuses: WorkflowDetail["statuses"],
	transitions: WorkflowDetail["transitions"],
	initialStatusId: string | null,
): Pick<WorkflowDetail, "statuses" | "transitions" | "initialStatusId"> => ({
	statuses,
	transitions,
	initialStatusId,
});

describe("workflow diagram geometry", () => {
	test("node widths follow the label length with the original bounds", () => {
		expect(nodeWidth("")).toBe(76);
		expect(nodeWidth("To Do")).toBe(76);
		expect(nodeWidth("In Progress")).toBeCloseTo(103.4);
		expect(nodeWidth("x".repeat(30))).toBeCloseTo(244);
		expect(nodeWidth("x".repeat(60))).toBeCloseTo(244);
	});

	test("a cubic bezier returns its endpoints and midpoint", () => {
		const p0 = { x: 0, y: 0 };
		const p1 = { x: 0, y: 10 };
		const p2 = { x: 10, y: 10 };
		const p3 = { x: 10, y: 0 };
		expect(bezierPoint(p0, p1, p2, p3, 0)).toEqual(p0);
		expect(bezierPoint(p0, p1, p2, p3, 1)).toEqual(p3);
		const middle = bezierPoint(p0, p1, p2, p3, 0.5);
		expect(middle.x).toBeCloseTo(5);
		expect(middle.y).toBeCloseTo(7.5);
	});
});

describe("layoutWorkflow", () => {
	test("lays out the three-status flow with a global entry and loops", () => {
		const layout = layoutWorkflow(workflowGallery.supportFlow);
		expect(layout.nodes).toHaveLength(4);
		expect(layout.edges).toHaveLength(5);

		const any = layout.nodes.find((node) => node.id === ANY);
		expect(any).toMatchObject({
			label: "Any status",
			category: "any",
			column: 0,
		});
		const initial = layout.nodes.find(
			(node) => node.id === workflowGallery.supportFlow.initialStatusId,
		);
		expect(initial?.initial).toBe(true);
		expect(layout.nodes.filter((node) => node.initial)).toHaveLength(1);

		for (const edge of layout.edges) {
			expect(edge.path.startsWith("M")).toBe(true);
			expect(Number.isFinite(edge.labelAt.x)).toBe(true);
			expect(Number.isFinite(edge.labelAt.y)).toBe(true);
		}
		expect(layout.edges.some((edge) => edge.from === ANY)).toBe(true);
		expect(
			layout.edges.some((edge) => {
				const from = layout.nodes.find((node) => node.id === edge.from);
				const to = layout.nodes.find((node) => node.id === edge.to);
				return (
					from !== undefined && to !== undefined && from.column > to.column
				);
			}),
		).toBe(true);

		const { minX, minY, maxX, maxY } = layout.bounds;
		expect(minX).toBeLessThan(maxX);
		expect(minY).toBeLessThan(maxY);
		for (const node of layout.nodes) {
			expect(node.x - node.width / 2).toBeGreaterThanOrEqual(minX);
			expect(node.x + node.width / 2).toBeLessThanOrEqual(maxX);
			expect(node.y).toBeGreaterThanOrEqual(minY);
			expect(node.y).toBeLessThanOrEqual(maxY);
		}
		for (const edge of layout.edges) {
			expect(edge.labelAt.x).toBeGreaterThanOrEqual(minX);
			expect(edge.labelAt.x).toBeLessThanOrEqual(maxX);
			expect(edge.labelAt.y).toBeGreaterThanOrEqual(minY);
			expect(edge.labelAt.y).toBeLessThanOrEqual(maxY);
		}
	});

	test("lays out ten statuses deterministically", () => {
		const first = layoutWorkflow(workflowGallery.releasePipeline);
		const second = layoutWorkflow(workflowGallery.releasePipeline);
		expect(first.nodes).toHaveLength(11);
		expect(first.edges).toHaveLength(15);
		expect(first).toEqual(second);
		expect(new Set(first.nodes.map((node) => node.id)).size).toBe(11);
		expect(new Set(first.edges.map((edge) => edge.id)).size).toBe(15);
		for (const status of workflowGallery.releasePipeline.statuses) {
			expect(first.nodes.some((node) => node.id === status.id)).toBe(true);
		}
		expect(Math.max(...first.nodes.map((node) => node.column))).toBeGreaterThan(
			3,
		);
	});

	test("handles same-column edges and filters unknown statuses", () => {
		const layout = layoutWorkflow(
			detail(
				[
					{
						id: "a",
						name: "Alpha",
						category: "new",
						issueCount: 0,
					},
					{
						id: "b",
						name: "Beta",
						category: "indeterminate",
						issueCount: 0,
					},
					{
						id: "c",
						name: "Gamma",
						category: "done",
						issueCount: 0,
					},
				],
				[
					{
						id: "ab",
						name: "To B",
						fromStatusId: "a",
						toStatusId: "b",
						asksResolution: false,
					},
					{
						id: "ac",
						name: "To C",
						fromStatusId: "a",
						toStatusId: "c",
						asksResolution: false,
					},
					{
						id: "bc",
						name: "B to C",
						fromStatusId: "b",
						toStatusId: "c",
						asksResolution: false,
					},
					{
						id: "missing-to",
						name: "Missing",
						fromStatusId: "a",
						toStatusId: "nope",
						asksResolution: false,
					},
					{
						id: "missing-from",
						name: "Missing too",
						fromStatusId: "nope",
						toStatusId: "b",
						asksResolution: false,
					},
				],
				"a",
			),
		);
		expect(layout.nodes).toHaveLength(3);
		expect(layout.edges.map((edge) => edge.id)).toEqual(["bc", "ab", "ac"]);
		const b = layout.nodes.find((node) => node.id === "b");
		const c = layout.nodes.find((node) => node.id === "c");
		expect(b?.column).toBe(c?.column);
		expect(layout.edges.find((edge) => edge.id === "bc")?.path).toContain("C");
	});

	test("returns empty bounds for an empty workflow", () => {
		expect(layoutWorkflow(detail([], [], null))).toEqual({
			nodes: [],
			edges: [],
			bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
		});
	});
});
