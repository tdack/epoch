<script lang="ts">
	import { tick } from 'svelte';
	import { X, ExternalLink } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { MarksStore } from '#lib/components/layout/marks-store.svelte.js';
	import PersonView from '#lib/components/person/PersonView.svelte';
	import { personPath } from '#lib/components/person/person-paths.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import type { TreeEditor } from './tree-editor.svelte.js';

	/**
	 * The frame around a person beside the canvas: the fixed panel, Close and Escape, and the link
	 * to the full page. What is inside it is the same `PersonView` the person page renders.
	 */
	interface Props {
		/** The person's page data; null while it loads. */
		page: PersonPageDto | null;
		treeId: string;
		role: TreeRole | undefined;
		/** Set when the page data could not be loaded. */
		error?: string | null;
		onClose: () => void;
		/** A relative was clicked: the canvas moves to them rather than leaving for their page. */
		onSelectPerson: (id: string) => void;
		editor: TreeEditor;
		toasts: ToastStore;
		marks: MarksStore;
	}

	let {
		page,
		treeId,
		role,
		error = null,
		onClose,
		onSelectPerson,
		editor,
		toasts,
		marks
	}: Props = $props();

	let panel: HTMLElement | null = $state(null);

	// Focus the heading when a person opens, so a keyboard or screen-reader user lands on who this
	// is. Keyed on the id: a reload after an edit shows the same person and must not take focus.
	let focusedId: string | null = null;
	$effect(() => {
		const id = page?.person.id ?? null;
		if (!id || id === focusedId) return;
		focusedId = id;
		void tick().then(() => panel?.querySelector<HTMLElement>('h2')?.focus());
	});

	function keydown(event: KeyboardEvent) {
		// A dialog opened from a section sits inside this panel; its own Escape must not close the panel too.
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		if ((event.target as Element).closest('dialog')) return;
		onClose();
	}
</script>

{#if page}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={panel}
		role="complementary"
		aria-label="Person details"
		onkeydown={keydown}
		class="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-stone-300 bg-[#fcfaf5]/98 shadow-2xl backdrop-blur-xl transition-transform duration-300 sm:w-96"
	>
		<div
			class="flex items-center justify-between border-b border-stone-200/90 bg-[#fbf8f0] px-6 py-3"
		>
			<a
				href={personPath(treeId, page.person.id)}
				class="text-link inline-flex items-center gap-1 text-xs"
			>
				<ExternalLink class="h-3 w-3" />
				<span>Open full page</span>
			</a>
			<button
				type="button"
				onclick={onClose}
				aria-label="Close details"
				class="cursor-pointer rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-800"
			>
				<X class="h-5 w-5" />
			</button>
		</div>
		<div class="flex-1 overflow-y-auto p-6">
			<PersonView
				dto={page}
				{treeId}
				{role}
				layout="drawer"
				relativeTarget={{ kind: 'select', onSelect: onSelectPerson }}
				{editor}
				{toasts}
				{marks}
			/>
		</div>
	</div>
{:else if error}
	<div
		class="fixed inset-y-0 right-0 z-50 w-full border-l border-stone-300 bg-[#fcfaf5] p-6 shadow-2xl sm:w-96"
		role="alert"
	>
		<button
			type="button"
			onclick={onClose}
			aria-label="Close details"
			class="float-right text-stone-400 hover:text-stone-800"><X class="h-5 w-5" /></button
		>
		<p class="text-sm text-red-800">{error}</p>
	</div>
{/if}
