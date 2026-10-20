<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import { suggestPlacesApi } from '#lib/api/lists.js';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'class' | 'list'> {
		/** The tree whose places are suggested. */
		treeId: string;
		/** The place as text. What is saved is whatever this holds; a suggestion only fills it in. */
		value: string;
		/** Id for the input, so the caller's `<label for>` points at it. */
		id: string;
		/** Classes for the input, so the field matches the form it sits in. */
		inputClass?: string;
		/** The input element, for a caller that needs to focus or select it. */
		element?: HTMLInputElement | null;
	}

	const uid = $props.id();
	let {
		treeId,
		value = $bindable(),
		id,
		inputClass = '',
		element = $bindable(null),
		...rest
	}: Props = $props();

	const listId = `${uid}-places`;
	const MIN_TYPED_CHARACTERS = 2;
	const SUGGEST_DELAY_MS = 250;

	// Places already on the tree's facts, offered as the user types so one place keeps one spelling.
	let options = $state<string[]>([]);
	// A slower earlier answer must not replace a later one.
	let latestRequest = 0;

	$effect(() => {
		const typed = (value ?? '').trim();
		const request = ++latestRequest;
		if (typed.length < MIN_TYPED_CHARACTERS) {
			options = [];
			return;
		}
		const timer = setTimeout(async () => {
			let found: string[] = [];
			try {
				found = await suggestPlacesApi(treeId, typed);
			} catch {
				// Suggestions are a convenience; a failed lookup just shows none.
			}
			if (request === latestRequest) options = found;
		}, SUGGEST_DELAY_MS);
		return () => clearTimeout(timer);
	});
</script>

<input
	type="text"
	autocomplete="off"
	{...rest}
	{id}
	bind:this={element}
	bind:value
	list={listId}
	class={inputClass}
/>
<datalist id={listId}
	>{#each options as option (option)}<option value={option}></option>{/each}</datalist
>
