<script lang="ts">
	import type { Snippet } from 'svelte';
	import { StickyNote } from '@lucide/svelte';

	interface Props {
		/** How many notes the record has. */
		noteCount: number;
		/** Names the disclosure for assistive tech: "the birth of Ann Ash". */
		label: string;
		/** The viewer may add a note, so an empty record still has something to open. */
		canAdd?: boolean;
		children: Snippet;
	}

	let { noteCount, label, canAdd = false, children }: Props = $props();
</script>

<!-- A fact keeps its notes beside it, next to its citations; nothing is drawn for a record with none the viewer cannot add to. -->
{#if noteCount > 0 || canAdd}
	<details class="mt-2 text-xs" data-testid="notes-disclosure">
		<summary
			class="flex cursor-pointer items-center gap-1 font-semibold text-stone-700"
			aria-label={`Notes on ${label}`}
		>
			<StickyNote class="h-3.5 w-3.5" aria-hidden="true" />
			{noteCount === 0 ? 'Add a note' : `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}`}
		</summary>
		<div class="mt-2">{@render children()}</div>
	</details>
{/if}
