<script lang="ts">
	import { untrack } from "svelte";
	import Button from "#lib/components/Button.svelte";
	import Icon from "#lib/components/Icon.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import { parseLabels } from "./helpers.ts";

	interface Props {
		labels: string[];
		onclose: () => void;
		onapply: (labels: string[]) => void;
	}

	let { labels, onclose, onapply }: Props = $props();

	let list = $state(untrack(() => labels));
	let text = $state("");

	function addFromText() {
		list = [...new Set([...list, ...parseLabels(text)])];
		text = "";
	}

	function apply() {
		onapply([...new Set([...list, ...parseLabels(text)])]);
		onclose();
	}
</script>

{#snippet footer()}
	<Button appearance="primary" onclick={apply}>Apply</Button>
	<Button appearance="subtle" onclick={onclose}>Cancel</Button>
{/snippet}

<Modal title="Labels" width={480} onClose={onclose} {footer}>
	<div class="wed-field">
		<label class="wed-label" for="wed-label-input">Add labels</label>
		<div class="label-row">
			<input
				id="wed-label-input"
				class="wed-input"
				placeholder="Type a label and press Enter"
				bind:value={text}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						addFromText();
					}
				}}
			/>
			<Button onclick={addFromText} isDisabled={text.trim() === ""}>Add</Button>
		</div>
		<p class="wed-hint">
			Labels are lowercase and cannot contain spaces; separate several with
			commas.
		</p>
	</div>
	{#if list.length === 0}
		<p class="wed-hint">No labels yet.</p>
	{:else}
		<ul class="wed-labels" aria-label="Labels">
			{#each list as label (label)}
				<li class="wed-label-chip">
					{label}
					<button
						type="button"
						class="wed-icon-button"
						aria-label={`Remove label ${label}`}
						onclick={() => (list = list.filter((item) => item !== label))}
					>
						<Icon name="close" size={12} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</Modal>

<style>
	.label-row {
		display: flex;
		gap: 8px;
	}
</style>
