<script lang="ts">
	import { absoluteDate } from "#lib/dates.ts";
	import { copyToClipboard } from "#lib/admin/clipboard.ts";
	import AdminPage from "#lib/admin/AdminPage.svelte";
	import Banner from "#lib/admin/Banner.svelte";
	import Button from "#lib/components/Button.svelte";
	import type { PageData } from "./$types";

	let { data }: { data: PageData } = $props();

	let copied = $state(false);
	let copyError = $state<string | null>(null);

	$effect(() => {
		if (!copied) return;
		const timer = setTimeout(() => (copied = false), 4000);
		return () => clearTimeout(timer);
	});

	function formatStorage(bytes: number) {
		if (bytes < 1024) return `${bytes} B`;
		const units = ["KB", "MB", "GB", "TB"];
		let value = bytes / 1024;
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit += 1;
		}
		return `${value.toFixed(1)} ${units[unit]}`;
	}

	function formatUptime(seconds: number) {
		const days = Math.floor(seconds / 86_400);
		const hours = Math.floor((seconds % 86_400) / 3600);
		const minutes = Math.floor((seconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}

	function plural(count: number, unit: string) {
		return `${count} ${unit}${count === 1 ? "" : "s"}`;
	}

	function asText() {
		const info = data.info;
		return [
			"RVNA system information",
			`Version: ${info.version ?? "Not reported"}`,
			`Node.js: ${info.node}`,
			`PostgreSQL: ${info.postgres}`,
			`Base URL: ${info.appUrl}`,
			`Started: ${absoluteDate(info.startedAt)}`,
			`Uptime: ${formatUptime(info.uptimeSeconds)}`,
			`Database migrations applied: ${info.migrationCount}`,
			`Users: ${info.counts.users} (${info.counts.activeUsers} active)`,
			`Projects: ${info.counts.projects}`,
			`Issues: ${info.counts.issues}`,
			`Attachments: ${info.counts.attachments} (${formatStorage(info.attachmentBytes)})`,
		].join("\n");
	}

	async function copyAsText() {
		try {
			const ok = await copyToClipboard(asText());
			copied = ok;
			copyError = ok
				? null
				: "The clipboard is not available in this browser. Copy the values below instead.";
		} catch {
			copied = false;
			copyError =
				"The clipboard is not available in this browser. Copy the values below instead.";
		}
	}
</script>

<AdminPage
	title="System info"
	description="What this installation is running, and how much it holds."
>
	{#snippet actions()}
		<Button onclick={() => void copyAsText()}>Copy as text</Button>
	{/snippet}

	{#if copied}
		<Banner tone="success">Copied to the clipboard.</Banner>
	{/if}
	{#if copyError}
		<Banner tone="warning">{copyError}</Banner>
	{/if}

	<section class="block">
		<h2>Application</h2>
		<dl>
			<dt>Version</dt>
			<dd>
				{data.info.version ?? "Not reported"}
				{#if !data.info.version}
					<div class="hint">
						Set the APP_VERSION environment variable to report one.
					</div>
				{/if}
			</dd>
			<dt>Node.js</dt>
			<dd>{data.info.node}</dd>
			<dt>PostgreSQL</dt>
			<dd>{data.info.postgres}</dd>
			<dt>Uptime</dt>
			<dd>
				{formatUptime(data.info.uptimeSeconds)}
				<div class="hint">Started {absoluteDate(data.info.startedAt)}</div>
			</dd>
			<dt>Base URL</dt>
			<dd>{data.info.appUrl}</dd>
		</dl>
	</section>

	<section class="block">
		<h2>Database</h2>
		<dl>
			<dt>Migrations applied</dt>
			<dd>
				{data.info.migrationCount}
				<div class="hint">
					Schema migrations recorded in drizzle.__drizzle_migrations.
				</div>
			</dd>
		</dl>
	</section>

	<section>
		<h2>Usage</h2>
		<dl>
			<dt>Users</dt>
			<dd>
				{plural(data.info.counts.users, "user")}
				<div class="hint">
					{plural(data.info.counts.activeUsers, "active user")}
				</div>
			</dd>
			<dt>Projects</dt>
			<dd>{plural(data.info.counts.projects, "project")}</dd>
			<dt>Issues</dt>
			<dd>{plural(data.info.counts.issues, "issue")}</dd>
			<dt>Attachments</dt>
			<dd>
				{plural(data.info.counts.attachments, "file")}
				<div class="hint">
					{formatStorage(data.info.attachmentBytes)} stored
				</div>
			</dd>
		</dl>
	</section>
</AdminPage>

<style>
	.block {
		margin-bottom: 24px;
	}

	h2 {
		margin: 0 0 12px;
		font-size: 16px;
		font-weight: 600;
		color: var(--ds-text);
	}

	dl {
		display: grid;
		grid-template-columns: 200px 1fr;
		row-gap: 10px;
		column-gap: 16px;
		margin: 0;
		padding: 0;
		max-width: 720px;
	}

	dt {
		font-size: 12px;
		font-weight: 600;
		color: var(--ds-text-subtle);
	}

	dd {
		margin: 0;
		color: var(--ds-text);
		overflow-wrap: anywhere;
	}

	.hint {
		margin-top: 2px;
		font-size: 12px;
		color: var(--ds-text-subtle);
	}
</style>
