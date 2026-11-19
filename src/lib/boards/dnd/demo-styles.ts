export type DemoStyle = Record<string, string>;

export const pageStyle: DemoStyle = {
	minHeight: "100vh",
	padding: "12px 24px 20px",
	backgroundColor: "var(--ds-surface, #1f1f21)",
	color: "var(--ds-text, #cecfd2)",
};

export const headerStyle: DemoStyle = {
	display: "flex",
	alignItems: "baseline",
	gap: "12px",
	margin: "0 0 10px",
};

export const titleStyle: DemoStyle = {
	margin: "0",
	fontSize: "24px",
	lineHeight: "32px",
	fontWeight: "500",
};

export const subtitleStyle: DemoStyle = {
	margin: "0",
	fontSize: "12px",
	lineHeight: "16px",
	color: "var(--ds-text-subtle, #a9abaf)",
};

export const layoutStyle: DemoStyle = {
	display: "grid",
	gridTemplateColumns: "minmax(0, 2fr) minmax(360px, 1fr)",
	gap: "16px",
	alignItems: "start",
};

export const sectionStyle: DemoStyle = {
	minWidth: "0",
};

export const sectionTitleStyle: DemoStyle = {
	margin: "0 0 6px",
	fontSize: "16px",
	lineHeight: "24px",
	fontWeight: "600",
};

export const laneStyle: DemoStyle = {
	marginBottom: "8px",
};

export const laneHeaderStyle: DemoStyle = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
	padding: "0 2px 4px",
	fontSize: "12px",
	fontWeight: "600",
	color: "var(--ds-text-subtle, #a9abaf)",
	textTransform: "uppercase",
	letterSpacing: "0.04em",
};

export const laneCountStyle: DemoStyle = {
	fontWeight: "400",
	color: "var(--ds-text-subtlest, #96999e)",
	textTransform: "none",
	letterSpacing: "0",
};

export const columnsStyle: DemoStyle = {
	display: "grid",
	gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
	gap: "8px",
};

export const columnZoneStyle: DemoStyle = {
	position: "relative",
	minHeight: "128px",
	padding: "6px",
	backgroundColor: "var(--ds-surface-sunken, #18191a)",
	borderRadius: "3px",
};

export const columnHeaderStyle: DemoStyle = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	padding: "0 2px 6px",
	fontSize: "12px",
	fontWeight: "600",
	color: "var(--ds-text-subtle, #a9abaf)",
};

export const columnCountStyle: DemoStyle = {
	fontWeight: "400",
	color: "var(--ds-text-subtlest, #96999e)",
};

export const cardSlotStyle: DemoStyle = {
	position: "relative",
};

export const emptyStyle: DemoStyle = {
	padding: "8px",
	fontSize: "12px",
	color: "var(--ds-text-subtlest, #96999e)",
};

export const backlogSprintZoneStyle: DemoStyle = {
	position: "relative",
	marginBottom: "8px",
	backgroundColor: "var(--ds-surface-sunken, #18191a)",
	border: "1px solid var(--ds-border, #3b3d42)",
	borderRadius: "3px",
};

export const backlogListZoneStyle: DemoStyle = {
	position: "relative",
	backgroundColor: "var(--ds-surface-sunken, #18191a)",
	border: "1px solid var(--ds-border, #3b3d42)",
	borderRadius: "3px",
};

export const backlogHeaderStyle: DemoStyle = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
	padding: "6px 8px",
	borderBottom: "1px solid var(--ds-border, #3b3d42)",
};

export const sprintNameStyle: DemoStyle = {
	fontWeight: "600",
};

export const metaStyle: DemoStyle = {
	color: "var(--ds-text-subtle, #a9abaf)",
	fontSize: "12px",
};

export const headerRightStyle: DemoStyle = {
	marginLeft: "auto",
	display: "flex",
	alignItems: "center",
	gap: "8px",
};

export const hintStyle: DemoStyle = {
	margin: "10px 0 0",
	fontSize: "12px",
	lineHeight: "16px",
	color: "var(--ds-text-subtle, #a9abaf)",
};

export const dropIndicatorStyle: DemoStyle = {
	position: "absolute",
	top: "-1px",
	left: "0",
	right: "0",
	zIndex: "2",
	height: "2px",
	borderRadius: "1px",
	backgroundColor: "var(--ds-border-dropindicator, #4688ec)",
	pointerEvents: "none",
};
