<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { BookOpen } from 'lucide-svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSourceApi, isConflict, updateSourceApi } from '#lib/services/tree-api.js';
	import type { SourceDto } from '#lib/shared/evidence.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The source being edited, or null to make one. */
		source: Pick<
			SourceDto,
			'id' | 'version' | 'title' | 'author' | 'publication' | 'abbreviation' | 'text'
		> | null;
		/** Called after a save with the change (and the new source's id when one was made). */
		onsaved: (change: ChangeSummary | null, sourceId: string) => void | Promise<void>;
		/** Called when the source changed under the editor; the caller reloads. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, source, onsaved, onstale, oncancel }: Props = $props();

	let title = $state('');
	let author = $state('');
	let publication = $state('');
	let abbreviation = $state('');
	let text = $state('');
	let error = $state<string | null>(null);
	let isSaving = $state(false);
	let titleInput = $state<HTMLInputElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	// Filled when the dialog opens only, so a reload underneath does not wipe what has been typed.
	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => source);
		title = from?.title ?? '';
		author = from?.author ?? '';
		publication = from?.publication ?? '';
		abbreviation = from?.abbreviation ?? '';
		text = from?.text ?? '';
		error = null;
		void tick().then(() => titleInput?.focus());
	});

	async function save() {
		const input = {
			title: title.trim() || null,
			author: author.trim() || null,
			publication: publication.trim() || null,
			abbreviation: abbreviation.trim() || null,
			text: text.trim() || null
		};
		if (!input.title && !input.abbreviation && !input.text) {
			error = 'Give the source a title, an abbreviation or its text.';
			return;
		}
		isSaving = true;
		error = null;
		try {
			if (source) {
				const { change } = await updateSourceApi(treeId, source.id, input, source.version);
				await onsaved(change, source.id);
			} else {
				const created = await createSourceApi(treeId, input);
				await onsaved(created.change, created.sourceId);
			}
		} catch (cause: unknown) {
			if (isConflict(cause)) await onstale(cause.message);
			else error = (cause as Error).message || 'Could not save the source';
		} finally {
			isSaving = false;
		}
	}
</script>

<BaseModal
	{isOpen}
	title={source ? 'Edit source' : 'Add a source'}
	icon={BookOpen}
	maxWidthClass="max-w-lg"
	{error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="source-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<div>
			<label for="source-title" class="field-label">Title</label>
			<input
				id="source-title"
				type="text"
				bind:this={titleInput}
				bind:value={title}
				class={field}
				placeholder="e.g. Parish register of St Mary, Leeds"
			/>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="source-author" class="field-label">Author</label>
				<input id="source-author" type="text" bind:value={author} class={field} />
			</div>
			<div>
				<label for="source-abbreviation" class="field-label">Short name</label>
				<input id="source-abbreviation" type="text" bind:value={abbreviation} class={field} />
			</div>
		</div>
		<div>
			<label for="source-publication" class="field-label">Publication</label>
			<input id="source-publication" type="text" bind:value={publication} class={field} />
		</div>
		<div>
			<label for="source-text" class="field-label"
				>Words from the source <span class="font-normal text-stone-500">(optional)</span></label
			>
			<textarea id="source-text" rows="3" bind:value={text} class={field}></textarea>
		</div>
		<div class="flex gap-2 pt-1">
			<button
				type="button"
				onclick={oncancel}
				class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
				>Cancel</button
			>
			<button
				type="submit"
				disabled={isSaving}
				class="flex-1 cursor-pointer rounded-lg bg-emerald-800 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
				>{isSaving ? 'Saving…' : source ? 'Save source' : 'Add source'}</button
			>
		</div>
	</form>
</BaseModal>
