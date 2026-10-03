<script lang="ts">
	import type { Snippet } from 'svelte';
	import { claimStateOf } from '#lib/shared/evidence.js';
	import ClaimStateMarker from './ClaimStateMarker.svelte';

	interface Props {
		/** The record's citations; their number is the claim's evidence. */
		citationCount: number;
		/** Another fact of the same kind disagrees with this one. */
		isConflicting?: boolean;
		/** Names the disclosure for assistive tech: "the birth of Ann Ash". */
		label: string;

		children: Snippet;
	}

	let { citationCount, isConflicting = false, label, children }: Props = $props();

	const state = $derived(claimStateOf({ citationCount, isConflicting }));
</script>

<!-- A fact keeps the evidence for it beside it: the marker says where it stands, the disclosure opens the citations. -->
<details class="mt-2 text-xs" data-testid="citations-disclosure">
	<summary class="flex cursor-pointer items-center gap-2" aria-label={`Citations for ${label}`}>
		<ClaimStateMarker {state} {citationCount} />
	</summary>
	<div class="mt-2">{@render children()}</div>
</details>
