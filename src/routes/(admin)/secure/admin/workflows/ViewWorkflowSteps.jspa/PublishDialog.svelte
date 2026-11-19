<script lang="ts">
	import { onMount } from "svelte";
	import { ApiError, api } from "#lib/api.ts";
	import Banner from "#lib/admin/Banner.svelte";
	import ErrorText from "#lib/admin/ErrorText.svelte";
	import { inputStyle } from "#lib/admin/styles.ts";
	import Button from "#lib/components/Button.svelte";
	import Modal from "#lib/components/Modal.svelte";
	import type {
		Problem,
		PublishResult,
		WorkflowDetail,
	} from "#lib/workflow/types.ts";

	interface Props {
		detail: WorkflowDetail;
		onClose: () => void;
		onPublished: (result: PublishResult) => void;
	}

	let { detail, onClose, onPublished }: Props = $props();

	const uid = $props.id();

	let mapping = $state<Record<string, string>>({});
	let failure = $state<Problem[] | null>(null);
	let checkResult = $state<PublishResult | null>(null);
	let checking = $state(true);
	let checkFailed = $state(false);
	let checkError = $state<string | null>(null);
	let publishing = $state(false);
	let publishError = $state<string | null>(null);
	let checkSeq = 0;
	let checkController: AbortController | null = null;

	async function runCheck(
		next: Record<string, string>,
		signal?: AbortSignal,
	) {
		const seq = ++checkSeq;
		checking = true;
		checkFailed = false;
		checkError = null;
		try {
			const result = await api<PublishResult>(
				`/api/admin/workflows/${detail.id}/publish`,
				{
					method: "POST",
					body: JSON.stringify({ dryRun: true, statusMapping: next }),
					signal,
				},
			);
			if (seq === checkSeq) checkResult = result;
		} catch (cause) {
			if (signal?.aborted) return;
			if (seq === checkSeq) {
				checkFailed = true;
				checkError =
					cause instanceof Error ? cause.message : "Could not check the draft";
			}
		} finally {
			if (seq === checkSeq && !signal?.aborted) checking = false;
		}
	}

	onMount(() => {
		checkController = new AbortController();
		void runCheck(mapping, checkController.signal);
		return () => checkController?.abort();
	});

	let problems = $derived(failure ?? checkResult?.problems ?? []);
	let mappable = $derived(
		problems.filter((problem) => problem.code === "removed_status_in_use"),
	);
	let others = $derived(
		problems.filter((problem) => problem.code !== "removed_status_in_use"),
	);
	let invalidMapping = $derived(
		new Set(
			problems
				.filter((problem) => problem.code === "invalid_mapping")
				.map((problem) => problem.statusId),
		),
	);
	let mappingChosen = $derived(Object.keys(mapping));
	let mappedNeeded = $derived([
		...new Set([
			...mappable.map((problem) => problem.statusId as string),
			...problems
				.filter((problem) => problem.code === "invalid_mapping")
				.map((problem) => problem.statusId as string),
		]),
	]);
	let ready = $derived(
		!checking && !checkFailed && checkResult?.ok === true && failure === null,
	);

	function changeMapping(statusId: string, value: string) {
		failure = null;
		const next = { ...mapping };
		if (value === "") delete next[statusId];
		else next[statusId] = value;
		mapping = next;
		void runCheck(next, checkController?.signal);
	}

	function problemFor(statusId: string) {
		return problems.find(
			(item) =>
				item.statusId === statusId &&
				(item.code === "removed_status_in_use" ||
					item.code === "invalid_mapping"),
		);
	}

	async function publish() {
		if (!ready || publishing) return;
		publishing = true;
		publishError = null;
		try {
			const result = await api<PublishResult>(
				`/api/admin/workflows/${detail.id}/publish`,
				{
					method: "POST",
					body: JSON.stringify({ statusMapping: mapping }),
				},
			);
			onPublished(result);
		} catch (cause) {
			const body = cause instanceof ApiError ? cause.body : null;
			const reported = (body as { problems?: unknown } | null)?.problems;
			if (Array.isArray(reported) && reported.length > 0) {
				failure = reported as Problem[];
			} else {
				publishError =
					cause instanceof Error ? cause.message : "Could not publish the draft";
			}
		} finally {
			publishing = false;
		}
	}
</script>

<Modal title="Publish workflow" {onClose} width={560}>
	{#snippet footer()}
		<Button
			appearance="primary"
			type="submit"
			form={`${uid}-publish-form`}
			isDisabled={!ready}
			isLoading={publishing}
		>
			Publish
		</Button>
		<Button appearance="subtle" onclick={onClose}>Cancel</Button>
	{/snippet}
	<form
		id={`${uid}-publish-form`}
		method="POST"
		onsubmit={(event) => {
			event.preventDefault();
			publish();
		}}
	>
		{#if checking}
			<p class="checking">Checking the draft...</p>
		{/if}
		{#if checkError}
			<Banner tone="danger">
				Could not check the draft: {checkError}
			</Banner>
		{/if}
		{#if publishError}
			<Banner tone="danger">{publishError}</Banner>
		{/if}
		{#if ready}
			<Banner tone="success">
				The draft is valid. Publishing makes it the live workflow
				{mappingChosen.length > 0 ? " and moves the issues you mapped" : ""}.
			</Banner>
		{/if}
		{#if problems.length > 0}
			<p class="fix">Fix these problems before the draft can go live:</p>
		{/if}
		<ul class="problems">
			{#each others as problem (`${problem.code}-${problem.statusId ?? ""}-${problem.message}`)}
				<li>
					<span>{problem.message}</span>
				</li>
			{/each}
			{#each mappedNeeded as statusId (statusId)}
				{@const problem = problemFor(statusId)}
				<li class="mapping">
					{#if problem}
						<span>{problem.message}</span>
					{/if}
					<label class="mapping-label" for={`map-${statusId}`}>
						Move these issues to
					</label>
					<select
						id={`map-${statusId}`}
						style={inputStyle}
						value={mapping[statusId] ?? ""}
						onchange={(event) =>
							changeMapping(statusId, event.currentTarget.value)}
					>
						<option value="">Select a status</option>
						{#each detail.statuses as status (status.id)}
							<option value={status.id}>{status.name}</option>
						{/each}
					</select>
					{#if invalidMapping.has(statusId)}
						<ErrorText>Choose a status that stays in the workflow.</ErrorText>
					{/if}
				</li>
			{/each}
		</ul>
		<button type="submit" hidden aria-label="Submit form"></button>
	</form>
</Modal>

<style>
	.checking {
		margin: 0;
	}

	.fix {
		margin: 0 0 12px;
	}

	.problems {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.problems li {
		margin-bottom: 8px;
	}

	.problems li.mapping {
		margin-bottom: 12px;
	}

	.mapping-label {
		display: block;
		margin-top: 6px;
		font-size: 12px;
	}

	form {
		margin: 0;
	}
</style>
