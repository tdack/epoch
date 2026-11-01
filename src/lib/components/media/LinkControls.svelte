<script lang="ts">
	import { ArrowDown, ArrowUp, Pencil } from '@lucide/svelte';
	import { MAX_MEDIA_TITLE_LENGTH } from '#lib/shared/media.js';

	interface Props {
		/** The name of the file, for the accessible names of the buttons. */
		label: string;
		/** The title that overrides the file's for this record; null when there is none. */
		linkTitle: string | null;
		canMoveUp: boolean;
		canMoveDown: boolean;
		/** Saves the title; a blank string clears the override. Resolves when the change is stored. */
		onsavetitle: (title: string) => Promise<boolean>;
		onmove: (direction: 'up' | 'down') => void;
	}

	let { label, linkTitle, canMoveUp, canMoveDown, onsavetitle, onmove }: Props = $props();

	let isEditing = $state(false);
	let draft = $state('');
	let isSaving = $state(false);

	function start() {
		draft = linkTitle ?? '';
		isEditing = true;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (isSaving) return;
		isSaving = true;
		try {
			if (await onsavetitle(draft)) isEditing = false;
		} finally {
			isSaving = false;
		}
	}

	const buttonClass =
		'inline-flex items-center justify-center rounded-md p-1 text-stone-600 hover:bg-stone-100 disabled:opacity-30 coarse:p-2';
</script>

{#if isEditing}
	<form class="space-y-1" onsubmit={save} data-testid="link-title-form">
		<label class="block text-[11px] font-semibold text-stone-700">
			Title here
			<input
				type="text"
				bind:value={draft}
				maxlength={MAX_MEDIA_TITLE_LENGTH}
				placeholder="Uses the file’s title"
				class="mt-0.5 w-full rounded-md border border-stone-300 px-1.5 py-1 text-xs font-normal"
			/>
		</label>
		<div class="flex gap-1.5">
			<button
				type="submit"
				disabled={isSaving}
				class="rounded-md bg-emerald-800 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
				>Save title</button
			>
			<button
				type="button"
				disabled={isSaving}
				onclick={() => (isEditing = false)}
				class="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-semibold text-stone-700"
				>Cancel</button
			>
		</div>
	</form>
{:else}
	<div class="flex items-center gap-0.5 print:hidden">
		<button type="button" class={buttonClass} onclick={start}>
			<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
			<span class="sr-only">Edit title of {label} here</span>
		</button>
		<button type="button" class={buttonClass} disabled={!canMoveUp} onclick={() => onmove('up')}>
			<ArrowUp class="h-3.5 w-3.5" aria-hidden="true" />
			<span class="sr-only">Move {label} earlier</span>
		</button>
		<button
			type="button"
			class={buttonClass}
			disabled={!canMoveDown}
			onclick={() => onmove('down')}
		>
			<ArrowDown class="h-3.5 w-3.5" aria-hidden="true" />
			<span class="sr-only">Move {label} later</span>
		</button>
	</div>
{/if}
