<script lang="ts">
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { Pencil, Star } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { setFavoriteApi } from '#lib/api/lists.js';
	import { canChangeRecords, type TreeRole } from '#lib/shared/roles.js';

	interface Props {
		person: { id: string; displayName: string };
		treeId: string;
		/** The viewer's role in this tree; editing the person needs an editor. */
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
	}

	let { person, treeId, role, editor, toasts, marks }: Props = $props();

	const isFavorite = $derived(marks.favorites.some((f) => f.id === person.id));
	const canChange = $derived(canChangeRecords(role));

	async function toggleFavorite() {
		try {
			marks.set(await setFavoriteApi(treeId, person.id, !isFavorite));
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not change the favourite'), { tone: 'error' });
		}
	}

	// Icon-only, unlike the toolbar, because beside the name the pencil and star read on their own;
	// the title is a pointer's tooltip and the label is the verb for a screen reader.
	const iconBtn =
		'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-stone-500 focus-ring transition-colors hover:bg-stone-200 hover:text-stone-900 coarse:h-11 coarse:w-11 print:hidden';
</script>

{#if canChange}<button
		type="button"
		onclick={() => void editor.openEditPerson(person.id)}
		aria-label={`Edit ${person.displayName}`}
		title="Edit"
		class={iconBtn}><Pencil class="h-4 w-4" aria-hidden="true" /></button
	>{/if}
{#if !marks.isReadOnly}<button
		type="button"
		onclick={toggleFavorite}
		aria-pressed={isFavorite}
		aria-label="Favourite"
		title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
		class={iconBtn}
		data-testid="favorite-toggle"
		><Star
			class="h-4 w-4 {isFavorite ? 'fill-amber-400 text-amber-500' : ''}"
			aria-hidden="true"
		/></button
	>{/if}
