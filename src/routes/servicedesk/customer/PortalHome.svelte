<script lang="ts">
	import Icon from "#lib/components/Icon.svelte";
	import PortalBreadcrumb from "./PortalBreadcrumb.svelte";
	import PortalCard from "./PortalCard.svelte";

	interface PortalRequestType {
		id: string;
		name: string;
		description: string | null;
	}

	interface PortalGroup {
		id: string;
		name: string;
		requestTypes: PortalRequestType[];
	}

	interface PortalDetail {
		id: string;
		name: string;
		description: string | null;
		announcement: string | null;
		groups: PortalGroup[];
	}

	let {
		portal,
		groupId,
	}: {
		portal: PortalDetail;
		groupId: string | null;
	} = $props();

	const iconPalette = [
		"#5e6ad2",
		"#2f9e6f",
		"#b06ab3",
		"#c9772b",
		"#3a7bd5",
		"#a1442c",
	];

	let search = $state("");

	let selected = $derived(
		portal.groups.find((group) => group.id === groupId) ?? portal.groups[0],
	);
	let query = $derived(search.trim().toLowerCase());
	let matches = $derived(
		query === ""
			? null
			: portal.groups
					.map((group) => ({
						group,
						requestTypes: group.requestTypes.filter(
							(requestType) =>
								requestType.name.toLowerCase().includes(query) ||
								(requestType.description ?? "").toLowerCase().includes(query),
						),
					}))
					.filter((entry) => entry.requestTypes.length > 0),
	);
</script>

{#if portal.announcement}
	<div class="announcement">{portal.announcement}</div>
{/if}

<PortalCard>
	<PortalBreadcrumb items={[{ label: "Help Center" }]} />
	<h1 class="title">{portal.name}</h1>
	{#if portal.description}
		<p class="description">{portal.description}</p>
	{/if}

	<label class="search-label" for="portal-search">
		What do you need help with?
	</label>
	<div class="search-wrap">
		<span class="search-icon"><Icon name="search" size={14} /></span>
		<input
			id="portal-search"
			type="search"
			bind:value={search}
			placeholder="Search"
			class="search-input"
		/>
	</div>

	<div class="columns">
		<nav aria-label="Request type groups" class="groups">
			{#each portal.groups as group (group.id)}
				{@const active = selected?.id === group.id && matches === null}
				<a
					href={`/servicedesk/customer/portal/${portal.id}/group/${group.id}`}
					class="group-link"
					aria-current={active ? "page" : undefined}
					style:font-weight={active ? 600 : 400}
					style:color={active ? "var(--ds-text)" : "var(--ds-text-subtle)"}
					style:background-color={active
						? "var(--ds-background-selected)"
						: "transparent"}
				>
					{group.name}
				</a>
			{/each}
		</nav>

		<div class="requests">
			{#if matches === null}
				{#each selected?.requestTypes ?? [] as requestType, index (requestType.id)}
					<a
						class="fat-portal-row request-row"
						href={`/servicedesk/customer/portal/${portal.id}/create/${requestType.id}`}
					>
						<span
							aria-hidden="true"
							class="request-icon"
							style:background-color={iconPalette[index % iconPalette.length]}
						>
							{requestType.name.trim().charAt(0).toUpperCase() || "?"}
						</span>
						<span class="request-text">
							<span class="request-name">{requestType.name}</span>
							{#if requestType.description}
								<span class="request-description">{requestType.description}</span>
							{/if}
						</span>
					</a>
				{/each}
				{#if (selected?.requestTypes.length ?? 0) === 0}
					<p class="muted">This group has no request types yet.</p>
				{/if}
			{:else}
				{#each matches as entry (entry.group.id)}
					<div class="match-group">
						<h2 class="match-heading">{entry.group.name}</h2>
						{#each entry.requestTypes as requestType, index (requestType.id)}
							<a
								class="fat-portal-row request-row"
								href={`/servicedesk/customer/portal/${portal.id}/create/${requestType.id}`}
							>
								<span
									aria-hidden="true"
									class="request-icon"
									style:background-color={iconPalette[
										index % iconPalette.length
									]}
								>
									{requestType.name.trim().charAt(0).toUpperCase() || "?"}
								</span>
								<span class="request-text">
									<span class="request-name">{requestType.name}</span>
									{#if requestType.description}
										<span class="request-description"
											>{requestType.description}</span
										>
									{/if}
								</span>
							</a>
						{/each}
					</div>
				{/each}
				{#if matches.length === 0}
					<p class="muted">No request types match “{search.trim()}”.</p>
				{/if}
			{/if}
		</div>
	</div>
</PortalCard>

<style>
	.announcement {
		margin-bottom: 16px;
		padding: 12px 16px;
		border-radius: 3px;
		background-color: var(--ds-background-information);
		color: var(--ds-text);
	}

	.title {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
		line-height: 28px;
		color: var(--ds-text);
	}

	.description {
		margin: 0 0 24px;
		color: var(--ds-text-subtle);
	}

	.search-label {
		display: block;
		margin-bottom: 6px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ds-text);
	}

	.search-wrap {
		position: relative;
		margin-bottom: 24px;
	}

	.search-icon {
		position: absolute;
		left: 10px;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
		color: var(--ds-text-subtle);
	}

	.search-input {
		width: 100%;
		height: 36px;
		padding: 0 10px 0 32px;
		background-color: var(--ds-background-input);
		border: 1px solid var(--ds-border-input);
		border-radius: 3px;
		color: var(--ds-text);
		font-size: 14px;
	}

	.columns {
		display: flex;
		align-items: flex-start;
		gap: 40px;
	}

	.groups {
		width: 200px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.group-link {
		padding: 6px 8px;
		border-radius: 3px;
		font-size: 14px;
		text-decoration: none;
	}

	.requests {
		flex: 1;
		min-width: 0;
	}

	.request-row {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding: 10px 8px;
		border-radius: 3px;
		text-decoration: none;
		color: var(--ds-text);
	}

	.request-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		flex: none;
		border-radius: 50%;
		color: #ffffff;
		font-size: 14px;
		font-weight: 600;
	}

	.request-text {
		min-width: 0;
	}

	.request-name {
		display: block;
		font-size: 14px;
		font-weight: 500;
		color: var(--ds-link);
	}

	.request-description {
		display: block;
		font-size: 13px;
		color: var(--ds-text-subtle);
	}

	.match-group {
		margin-bottom: 20px;
	}

	.match-heading {
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.4px;
		color: var(--ds-text-subtle);
	}

	.muted {
		color: var(--ds-text-subtle);
	}
</style>
