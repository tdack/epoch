<script lang="ts">
	import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-svelte';
	import { CLAIM_STATE_LABELS, CLAIM_STATES, type ClaimState } from '#lib/shared/evidence.js';

	interface Props {
		state: ClaimState;
		/** How many citations support the claim; shown beside the word when there are any. */
		citationCount: number;
	}

	let { state, citationCount }: Props = $props();

	const STYLES: Record<ClaimState, string> = {
		sourced: 'text-emerald-800',
		unsourced: 'text-stone-600',
		conflicting: 'text-amber-800'
	};
</script>

<!-- The word carries the meaning; the icon and colour only echo it. -->
<span
	class="inline-flex items-center gap-1 text-xs font-semibold {STYLES[state]}"
	data-testid="claim-state"
	data-state={state}
>
	{#if state === CLAIM_STATES.SOURCED}<CircleCheck class="h-3.5 w-3.5" aria-hidden="true" />
	{:else if state === CLAIM_STATES.CONFLICTING}<CircleAlert
			class="h-3.5 w-3.5"
			aria-hidden="true"
		/>
	{:else}<CircleHelp class="h-3.5 w-3.5" aria-hidden="true" />{/if}
	{CLAIM_STATE_LABELS[state]}{#if citationCount > 0}{' '}<span class="font-normal"
			>· {citationCount} {citationCount === 1 ? 'citation' : 'citations'}</span
		>{/if}
</span>
