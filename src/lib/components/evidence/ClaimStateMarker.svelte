<script lang="ts">
	import { CircleAlert, Quote } from '@lucide/svelte';
	import { CLAIM_STATE_LABELS, CLAIM_STATES, type ClaimState } from '#lib/shared/evidence.js';

	interface Props {
		state: ClaimState;
		/** How many citations support the claim. */
		citationCount: number;
	}

	let { state, citationCount }: Props = $props();
</script>

<!--
	Unsourced is the normal state of a claim, so it draws nothing (ADR-028, amended). A sourced
	claim is a quote icon and its count, in the ink of the surrounding control so hover and open can
	recolour it; only a disagreement keeps a word. The control around it names the count.
-->
{#if state === CLAIM_STATES.CONFLICTING}
	<span
		class="inline-flex items-center gap-1 text-xs font-semibold text-amber-800"
		data-testid="claim-state"
		data-state={state}
	>
		<CircleAlert class="h-3.5 w-3.5" aria-hidden="true" />
		{CLAIM_STATE_LABELS[state]}{#if citationCount > 0}<span class="font-normal"
				>· {citationCount}</span
			>{/if}
	</span>
{:else if state === CLAIM_STATES.SOURCED}
	<span
		class="inline-flex items-center gap-1 text-xs font-semibold"
		data-testid="claim-state"
		data-state={state}
	>
		<Quote class="h-3.5 w-3.5" aria-hidden="true" />
		<span class="tabular-nums">{citationCount}</span>
	</span>
{/if}
