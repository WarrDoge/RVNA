<script lang="ts">
	import { onMount, tick } from "svelte";
	import type { CustomFieldColumn } from "#lib/api-types.ts";
	import Icon from "#lib/components/Icon.svelte";
	import {
		JqlError,
		parseJql,
		quoteJqlValue,
	} from "#lib/shared/jql/index.ts";
	import {
		fieldSuggestions,
		functionSuggestions,
		jqlContext,
		operatorSuggestions,
		type Suggestion,
	} from "./context.ts";
	import { suggestJqlValues } from "./suggest.ts";

	interface Props {
		value: string;
		onChange: (value: string) => void;
		onSubmit: () => void;
		customFields: CustomFieldColumn[];
		name?: string;
		placeholder?: string;
		/** The server refused the query, which the local parser cannot know. */
		rejected?: boolean;
	}

	let {
		value,
		onChange,
		onSubmit,
		customFields,
		name,
		placeholder = "Enter a JQL-compatible query",
		rejected = false,
	}: Props = $props();

	const uid = $props.id();
	const listboxId = `${uid}-jql-suggestions`;

	let input: HTMLInputElement;
	let hydrated = $state(false);
	let caret = $state(0);
	let focused = $state(false);
	let dismissed = $state(false);
	let active = $state(-1);
	let values = $state<string[]>([]);

	let valid = $derived.by(() => {
		try {
			parseJql(value);
			return { ok: !rejected, message: "" };
		} catch (error) {
			return {
				ok: false as const,
				message:
					error instanceof JqlError ? error.jiraMessage : "Invalid query",
			};
		}
	});

	let context = $derived(jqlContext(value, caret, customFields));
	let contextMode = $derived(context.mode);
	let contextField = $derived(context.field);
	let contextPartial = $derived(context.partial);

	let suggestions = $derived.by<Suggestion[]>(() => {
		if (context.mode === "field") {
			return fieldSuggestions(context.partial, customFields);
		}
		if (context.mode === "operator") {
			return operatorSuggestions(context.partial);
		}
		if (context.mode === "order") return [];
		const fromValues = values
			.filter((item) =>
				item
					.toLowerCase()
					.includes(context.partial.replace(/^"|"$/g, "").toLowerCase()),
			)
			.slice(0, 8)
			.map((item) => ({
				label: item,
				insert: quoteJqlValue(item),
				kind: "value" as const,
			}));
		return [...fromValues, ...functionSuggestions(context.partial)].slice(0, 8);
	});

	onMount(() => {
		if (!input) return;
		const focusedBeforeHydration = document.activeElement === input;
		// defaultValue keeps a value typed before hydration in the DOM; adopt it
		// before switching to the controlled value.
		if (input.value !== value) onChange(input.value);
		if (focusedBeforeHydration) {
			focused = true;
			caret = input.selectionStart ?? input.value.length;
		}
		void tick().then(() => (hydrated = true));
	});

	let open = $derived(focused && !dismissed && suggestions.length > 0);
	let activeIndex = $derived(
		suggestions.length === 0 ? -1 : Math.min(active, suggestions.length - 1),
	);

	$effect(() => {
		const mode = contextMode;
		const field = contextField;
		const partial = contextPartial;
		if (mode !== "value" || !field) {
			values = [];
			return;
		}
		let cancelled = false;
		const timer = window.setTimeout(() => {
			suggestJqlValues(field, partial.replace(/^"|"$/g, ""))
				.then((result) => {
					if (!cancelled) values = result.values;
				})
				.catch(() => {
					if (!cancelled) values = [];
				});
		}, 120);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	});

	function accept(suggestion: Suggestion) {
		const currentCaret = input?.selectionStart ?? caret;
		const start = currentCaret - context.partial.length;
		const next = `${value.slice(0, start)}${suggestion.insert} ${value.slice(currentCaret)}`;
		const position = start + suggestion.insert.length + 1;
		onChange(next);
		dismissed = true;
		void tick().then(() => {
			input?.focus();
			input?.setSelectionRange(position, position);
			caret = position;
		});
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (open) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				active = (active + 1) % suggestions.length;
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				active = active <= 0 ? suggestions.length - 1 : active - 1;
				return;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				const suggestion =
					suggestions[activeIndex < 0 && event.key === "Tab" ? 0 : activeIndex];
				if (suggestion) {
					event.preventDefault();
					accept(suggestion);
					return;
				}
			}
			if (event.key === "Escape") {
				event.preventDefault();
				dismissed = true;
				return;
			}
		}
		if (event.key === "Enter") {
			event.preventDefault();
			onSubmit();
		}
	}
</script>

<div class="root">
	<span
		class="validity"
		class:invalid={!valid.ok}
		aria-hidden="true"
		data-testid="jql-validity"
	>
		{#if valid.ok}
			<Icon name="check" size={16} />
		{:else}
			<Icon name="cross" size={16} />
		{/if}
	</span>
	<input
		bind:this={input}
		aria-label="Advanced search"
		aria-autocomplete="list"
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-controls={open ? listboxId : undefined}
		aria-activedescendant={activeIndex >= 0
			? `${uid}-jql-option-${activeIndex}`
			: undefined}
		aria-invalid={!valid.ok}
		{name}
		{placeholder}
		value={hydrated ? value : undefined}
		defaultValue={value}
		oninput={(event) => {
			onChange(event.currentTarget.value);
			caret = event.currentTarget.selectionStart ?? 0;
			dismissed = false;
			active = -1;
		}}
		onfocus={(event) => {
			focused = true;
			caret = event.currentTarget.selectionStart ?? 0;
		}}
		onblur={() => {
			focused = false;
			dismissed = false;
		}}
		onclick={(event) => (caret = event.currentTarget.selectionStart ?? 0)}
		onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? 0)}
		onkeydown={handleKeyDown}
		class="input"
	/>
	{#if open}
		<div
			class="suggestions"
			id={listboxId}
			role="listbox"
			aria-label="Advanced search suggestions"
		>
			{#each suggestions as suggestion, index (`${suggestion.kind}-${suggestion.label}`)}
				<button
					type="button"
					id={`${uid}-jql-option-${index}`}
					role="option"
					aria-selected={index === activeIndex}
					class="fat-menu-item suggestion"
					class:active={index === activeIndex}
					onmousedown={(event) => {
						event.preventDefault();
						accept(suggestion);
					}}
				>
					<span class="label" class:value={suggestion.kind === "value"}>{suggestion.label}</span><span class="kind">{suggestion.kind}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.root {
		position: relative;
		flex: 1;
		min-width: 0;
	}

	.validity {
		position: absolute;
		left: 8px;
		top: 8px;
		display: inline-flex;
		color: #22a06b;
	}

	.validity.invalid {
		color: #e5493a;
	}

	.input {
		width: 100%;
		min-width: 0;
		height: 32px;
		padding: 0 10px 0 30px;
		background: var(--ds-background-input, #ffffff);
		border: 1px solid var(--ds-border-input, #8c8f97);
		border-radius: 3px;
		color: var(--ds-text, #292a2e);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
		outline: none;
	}

	.input:focus-visible {
		outline: 2px solid var(--ds-border-focused, #669df1);
		outline-offset: 1px;
	}

	.suggestions {
		position: absolute;
		top: 34px;
		left: 0;
		right: 0;
		z-index: 120;
		max-height: 260px;
		overflow-y: auto;
		padding-block: 4px;
		background-color: var(--ds-surface-overlay, #ffffff);
		border: 1px solid var(--ds-border, #dfe1e6);
		border-radius: 3px;
		box-shadow: var(--ds-shadow-overlay, 0 8px 12px #1e1f2126);
	}

	.suggestions .suggestion {
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
	}

	.suggestions .suggestion.active {
		background: var(--ds-background-neutral-subtle-hovered, #ceced912);
	}

	.label {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.label.value {
		font-family: inherit;
	}

	.kind {
		margin-left: auto;
		font-size: 11px;
		color: var(--ds-text-subtle, #a9abaf);
		text-transform: uppercase;
	}
</style>
