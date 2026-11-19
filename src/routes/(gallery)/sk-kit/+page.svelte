<script lang="ts">
	import { token } from "#lib/tokens.ts";
	import Avatar from "#lib/components/Avatar.svelte";
	import Button from "#lib/components/Button.svelte";
	import ConfirmDialog from "#lib/components/ConfirmDialog.svelte";
	import { dismiss } from "#lib/components/dismiss.ts";
	import EmptyState from "#lib/components/EmptyState.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import {
		iconDefinitions,
		type IconName,
		issueTypeIconKeys,
	} from "#lib/components/icons.ts";
	import IssueTypeIcon from "#lib/components/IssueTypeIcon.svelte";
	import LogoMark from "#lib/components/LogoMark.svelte";
	import Lozenge from "#lib/components/Lozenge.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import Module from "#lib/components/Module.svelte";
	import NotFound from "#lib/components/NotFound.svelte";
	import PriorityIcon from "#lib/components/PriorityIcon.svelte";
	import ProjectAvatar from "#lib/components/ProjectAvatar.svelte";
	import Textfield from "#lib/components/Textfield.svelte";
	import UserLink from "#lib/components/UserLink.svelte";

	const sectionStyle = `padding: 16px 0 24px; border-bottom: 1px solid ${token("color.border")};`;
	const rowStyle =
		"display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 8px 0;";
	const labelStyle = `margin: 12px 0 4px; font-size: 12px; color: ${token("color.text.subtle")};`;
	const iconCaseStyle = `display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; color: ${token("color.text")};`;
	const popupStyle = `position: absolute; top: 36px; left: 0; z-index: 10; min-width: 160px; padding: 8px; background: ${token(
		"elevation.surface.overlay",
	)}; border: 1px solid ${token(
		"color.border",
	)}; border-radius: 3px; box-shadow: ${token("elevation.shadow.overlay")};`;
	const linkStyle = `color: ${token("color.link")}; text-decoration: none;`;
	const galleryStyle = `padding: 24px 32px 64px; background: ${token("elevation.surface")}; color: ${token("color.text")};`;

	const simpleIcons = (
		Object.keys(iconDefinitions) as IconName[]
	).filter(
		(name) =>
			!name.startsWith("issue-type-") && !name.startsWith("priority-"),
	);

	const avatarUser = {
		displayName: "Avery Stone",
		username: "ada",
		avatarUrl: null,
	};
	const avatarImageUser = {
		displayName: "Avery Stone",
		username: "ada",
		avatarUrl:
			"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64'%3E%3Crect width='64' height='64' fill='%23e5493a'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%23fff'/%3E%3Crect x='12' y='40' width='40' height='24' rx='12' fill='%23fff'/%3E%3C/svg%3E",
	};
	const priorityNames = ["Highest", "High", "Medium", "Low", "Lowest", "None"];

	let modalOpen = $state(false);
	let confirmOpen = $state(false);
	let dismissOpen = $state(false);
</script>

<svelte:head>
	<title>SK component gallery - RVNA</title>
</svelte:head>

{#snippet emptyAction()}
	<span style="display: inline-flex; gap: 24px;">
		<a href="#back" style={linkStyle}>Go back</a>
		<a href="#dashboard" style={linkStyle}>Go to the dashboard</a>
	</span>
{/snippet}

{#snippet moduleActions()}
	<Button spacing="compact">Edit</Button>
{/snippet}

{#snippet modalFooter()}
	<Button appearance="primary">Create</Button>
	<Button appearance="subtle" onclick={() => (modalOpen = false)}>Cancel</Button>
{/snippet}

<div id="sk-gallery" style={galleryStyle}>
	<h1 style="margin: 0 0 8px; font-size: 24px; font-weight: 600;">
		SK component gallery
	</h1>
	<p style="margin: 0; color: {token('color.text.subtle')};">
		The shared Svelte components, state by state.
	</p>

	<section data-gallery="button" style={sectionStyle}>
		<h2>Button</h2>
		<p style={labelStyle}>appearance</p>
		<div data-case="button-default" style={rowStyle}>
			<Button>Default</Button>
		</div>
		<div data-case="button-primary" style={rowStyle}>
			<Button appearance="primary">Primary</Button>
		</div>
		<div data-case="button-subtle" style={rowStyle}>
			<Button appearance="subtle">Subtle</Button>
		</div>
		<div data-case="button-danger" style={rowStyle}>
			<Button appearance="danger">Danger</Button>
		</div>
		<p style={labelStyle}>spacing</p>
		<div data-case="button-compact" style={rowStyle}>
			<Button spacing="compact">Compact</Button>
		</div>
		<p style={labelStyle}>link</p>
		<div data-case="button-link" style={rowStyle}>
			<Button href="#link">Link button</Button>
		</div>
		<div data-case="button-link-subtle" style={rowStyle}>
			<Button href="#link" appearance="subtle">Subtle link</Button>
		</div>
		<p style={labelStyle}>states</p>
		<div data-case="button-disabled" style={rowStyle}>
			<Button isDisabled>Disabled</Button>
		</div>
		<div data-case="button-selected" style={rowStyle}>
			<Button isSelected>Selected</Button>
		</div>
		<div data-case="button-loading" style={rowStyle}>
			<Button appearance="primary" isLoading>Loading</Button>
		</div>
		<div data-case="button-hover" style={rowStyle}>
			<Button>Hover me</Button>
		</div>
		<div data-case="button-hover-primary" style={rowStyle}>
			<Button appearance="primary">Hover primary</Button>
		</div>
		<div data-case="button-hover-subtle" style={rowStyle}>
			<Button appearance="subtle">Hover subtle</Button>
		</div>
		<div data-case="button-hover-danger" style={rowStyle}>
			<Button appearance="danger">Hover danger</Button>
		</div>
		<div data-case="button-focus" style={rowStyle}>
			<Button>Focus me</Button>
		</div>
		<div data-case="button-focus-primary" style={rowStyle}>
			<Button appearance="primary">Focus primary</Button>
		</div>
	</section>

	<section data-gallery="lozenge" style={sectionStyle}>
		<h2>Lozenge</h2>
		<div data-case="lozenge-default" style={rowStyle}>
			<Lozenge>Default</Lozenge>
		</div>
		<div data-case="lozenge-success" style={rowStyle}>
			<Lozenge appearance="success">Success</Lozenge>
		</div>
		<div data-case="lozenge-moved" style={rowStyle}>
			<Lozenge appearance="moved">Moved</Lozenge>
		</div>
		<div data-case="lozenge-new" style={rowStyle}>
			<Lozenge appearance="new">New</Lozenge>
		</div>
		<div data-case="lozenge-removed" style={rowStyle}>
			<Lozenge appearance="removed">Removed</Lozenge>
		</div>
		<div data-case="lozenge-inprogress" style={rowStyle}>
			<Lozenge appearance="inprogress">In progress</Lozenge>
		</div>
	</section>

	<section data-gallery="empty-state" style={sectionStyle}>
		<h2>EmptyState</h2>
		<div data-case="empty-state-header">
			<EmptyState header="Nothing here yet" />
		</div>
		<div data-case="empty-state-full">
			<EmptyState
				header="This page does not exist"
				description="The link may be broken, or the page may have been moved or deleted."
				primaryAction={emptyAction}
			/>
		</div>
	</section>

	<section data-gallery="textfield" style={sectionStyle}>
		<h2>Textfield</h2>
		<div style="display: grid; gap: 12px; max-width: 360px;">
			<div data-case="textfield-default">
				<label for="sk-name">Name</label>
				<Textfield id="sk-name" placeholder="e.g. CI pipeline" />
			</div>
			<div data-case="textfield-value">
				<label for="sk-value">Name</label>
				<Textfield id="sk-value" value="Release train" />
			</div>
			<div data-case="textfield-disabled">
				<label for="sk-disabled">Name</label>
				<Textfield id="sk-disabled" isDisabled value="Disabled" />
			</div>
		</div>
	</section>

	<section data-gallery="icon" style={sectionStyle}>
		<h2>Icons</h2>
		<div style="display: flex; flex-wrap: wrap; gap: 4px;">
			{#each simpleIcons as name (name)}
				<div data-case={`icon-${name}`} style={iconCaseStyle} title={name}>
					<Icon {name} />
				</div>
			{/each}
		</div>
	</section>

	<section data-gallery="issue-icons" style={sectionStyle}>
		<h2>Issue type and priority icons</h2>
		<div style="display: flex; flex-wrap: wrap; gap: 4px;">
			{#each issueTypeIconKeys as entry (entry.key)}
				<div
					data-case={`icon-issue-type-${entry.key}`}
					style={iconCaseStyle}
					title={`issue-type-${entry.key}`}
				>
					<IssueTypeIcon name={entry.label} />
				</div>
			{/each}
			{#each priorityNames as name (name)}
				<div
					data-case={`icon-priority-${name.toLowerCase()}`}
					style={iconCaseStyle}
					title={`priority-${name.toLowerCase()}`}
				>
					<PriorityIcon {name} />
				</div>
			{/each}
		</div>
	</section>

	<section data-gallery="avatar" style={sectionStyle}>
		<h2>Avatar</h2>
		<div data-case="avatar-initials" style={rowStyle}>
			<Avatar user={avatarUser} />
		</div>
		<div data-case="avatar-image" style={rowStyle}>
			<Avatar user={avatarImageUser} />
		</div>
		<div data-case="avatar-96" style={rowStyle}>
			<Avatar user={avatarUser} size={96} />
		</div>
		<div data-case="project-avatar-initials" style={rowStyle}>
			<ProjectAvatar name="Platform" avatarUrl={null} />
		</div>
		<div data-case="project-avatar-image" style={rowStyle}>
			<ProjectAvatar name="Platform" avatarUrl={avatarImageUser.avatarUrl} />
		</div>
	</section>

	<section data-gallery="logo" style={sectionStyle}>
		<h2>Logo</h2>
		<div data-case="logo-default" style={rowStyle}>
			<LogoMark />
		</div>
		<div data-case="logo-32" style={rowStyle}>
			<LogoMark size={32} />
		</div>
	</section>

	<section data-gallery="profile-link" style={sectionStyle}>
		<h2>UserLink</h2>
		<div data-case="user-link" style={rowStyle}>
			<UserLink username="ada">Avery Stone</UserLink>
		</div>
	</section>

	<section data-gallery="module" style={sectionStyle}>
		<h2>Module</h2>
		<div data-case="module-open" style="width: 420px;">
			<Module title="Details" actions={moduleActions}>
				<p style="margin: 0;">Module content</p>
			</Module>
		</div>
		<div data-case="module-closed" style="width: 420px;">
			<Module title="Closed module" defaultOpen={false}>
				<p style="margin: 0;">Hidden content</p>
			</Module>
		</div>
	</section>

	<section data-gallery="modal" style={sectionStyle}>
		<h2>Modal</h2>
		<div data-case="modal-trigger" style={rowStyle}>
			<Button appearance="primary" onclick={() => (modalOpen = true)}
				>Open modal</Button
			>
			<Button onclick={() => (confirmOpen = true)}>Open confirm</Button>
		</div>
		{#if modalOpen}
			<Modal
				title="Create token"
				onClose={() => (modalOpen = false)}
				footer={modalFooter}
			>
				<label for="modal-name">Name</label>
				<Textfield id="modal-name" placeholder="e.g. CI pipeline" />
				<label for="modal-days">Expires in days</label>
				<Textfield id="modal-days" type="number" min={1} placeholder="Never" />
			</Modal>
		{/if}
		{#if confirmOpen}
			<ConfirmDialog
				title="Delete token"
				message="This token will stop working immediately."
				onConfirm={() => (confirmOpen = false)}
				onClose={() => (confirmOpen = false)}
			/>
		{/if}
	</section>

	<section data-gallery="dismiss" style={sectionStyle}>
		<h2>Dismiss</h2>
		<div data-case="dismiss-trigger" style={rowStyle}>
			<div
				style="position: relative; display: inline-block;"
				{@attach dismiss(() => dismissOpen, () => (dismissOpen = false))}
			>
				<Button
					onclick={() => (dismissOpen = !dismissOpen)}
					aria-expanded={dismissOpen}>Open menu</Button
				>
				{#if dismissOpen}
					<div role="menu" style={popupStyle}>
						<span style="color: {token('color.text')};">Dismissible content</span>
					</div>
				{/if}
			</div>
		</div>
	</section>

	<section data-gallery="not-found" style={sectionStyle}>
		<h2>NotFound</h2>
		<div data-case="not-found">
			<NotFound />
		</div>
	</section>
</div>
