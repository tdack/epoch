<script lang="ts">
	import { isHexColour } from '#lib/shared/colour.js';

	interface Props {
		/** Unique in the page; the inputs, hint and error take their ids from it. */
		id: string;
		/** What the colour is for, such as "Male". */
		label: string;
		/** The current colour, six-digit hex. */
		value: string;
		/** Called with a valid lower-case colour; text that is not a colour stays here with an error. */
		onchange: (value: string) => void;
		/** A rule the colour breaks, such as a contrast floor; shown under the field. */
		error?: string | null;
		/** Extra text read with the field, such as its contrast figures. */
		hint?: string | null;
	}

	let { id, label, value, onchange, error = null, hint = null }: Props = $props();

	// Follows the value until the person types; what they type stays even while it is not a colour.
	let text = $derived(value);
	const isTextValid = $derived(isHexColour(text));
	const shownError = $derived(
		isTextValid ? error : 'Enter a colour as # and six hex digits, such as #5a84b5.'
	);
	const describedBy = $derived(
		[hint ? `${id}-hint` : null, shownError ? `${id}-error` : null].filter(Boolean).join(' ') ||
			undefined
	);

	function typed(next: string) {
		text = next.trim();
		if (isHexColour(text)) onchange(text.toLowerCase());
	}
</script>

<div class="flex flex-col gap-1">
	<label for="{id}-text" class="text-sm font-semibold text-stone-800">{label}</label>
	<div class="flex items-center gap-2">
		<span
			class="h-8 w-8 shrink-0 rounded-md border border-stone-400"
			style:background-color={isHexColour(value) ? value : undefined}
			aria-hidden="true"
		></span>
		<input
			id="{id}-text"
			type="text"
			class="w-28 rounded-md border px-2 py-1 font-mono text-sm {shownError
				? 'border-red-700'
				: 'border-stone-400'}"
			value={text}
			oninput={(event) => typed(event.currentTarget.value)}
			spellcheck="false"
			autocomplete="off"
			aria-invalid={shownError ? 'true' : undefined}
			aria-describedby={describedBy}
		/>
		<input
			id="{id}-picker"
			type="color"
			class="h-8 w-10 cursor-pointer rounded-md border border-stone-400 bg-white p-0.5"
			value={isHexColour(value) ? value : '#000000'}
			oninput={(event) => typed(event.currentTarget.value)}
			aria-label="{label}: choose with a colour picker"
		/>
	</div>
	{#if hint}
		<p id="{id}-hint" class="text-xs text-stone-600">{hint}</p>
	{/if}
	{#if shownError}
		<p id="{id}-error" class="text-xs font-medium text-red-800">{shownError}</p>
	{/if}
</div>
