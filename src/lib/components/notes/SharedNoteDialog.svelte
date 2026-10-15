<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { StickyNote } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { createSubmission } from '#lib/components/forms/submission.svelte.js';
	import { createSharedNoteApi, updateSharedNoteApi } from '#lib/api/tree-api.js';
	import type { SharedNoteDto } from '#lib/shared/notes.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The shared note being edited, or null to make one. */
		note: Pick<SharedNoteDto, 'id' | 'version' | 'text' | 'mime' | 'language' | 'useCount'> | null;
		/** Called after a save with the change (and the new note's id when one was made). */
		onsaved: (change: ChangeSummary | null, noteId: string) => void | Promise<void>;
		/** Called when the note changed under the editor; the caller reloads. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, note, onsaved, onstale, oncancel }: Props = $props();

	let text = $state('');
	let mime = $state('');
	let language = $state('');
	const submission = createSubmission((message) => onstale(message));
	let textArea = $state<HTMLTextAreaElement | null>(null);

	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	// Filled when the dialog opens only, so a reload underneath does not wipe what has been typed.
	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => note);
		text = from?.text ?? '';
		mime = from?.mime ?? '';
		language = from?.language ?? '';
		submission.error = null;
		void tick().then(() => textArea?.focus());
	});

	async function save() {
		const words = text.trim();
		if (!words) {
			submission.error = 'A note needs some text.';
			return;
		}
		const input = { mime: mime.trim() || null, language: language.trim() || null };
		await submission.submit(async () => {
			if (note) {
				const { change } = await updateSharedNoteApi(
					treeId,
					note.id,
					{ ...input, text: words },
					note.version
				);
				await onsaved(change, note.id);
			} else {
				const created = await createSharedNoteApi(treeId, { ...input, text: words });
				await onsaved(created.change, created.noteId);
			}
		}, 'Could not save the note');
	}
</script>

<BaseModal
	{isOpen}
	title={note ? 'Edit shared note' : 'Add a shared note'}
	subtitle={note
		? `Used by ${note.useCount} ${note.useCount === 1 ? 'record' : 'records'}`
		: 'Attach it to records afterwards from their pages'}
	icon={StickyNote}
	maxWidthClass="max-w-lg"
	error={submission.error}
	onclose={oncancel}
>
	<form
		class="space-y-3"
		data-testid="shared-note-form"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<div>
			<label for="shared-note-text" class="field-label">Note</label>
			<textarea
				id="shared-note-text"
				rows="8"
				bind:this={textArea}
				bind:value={text}
				class={field}
				data-testid="shared-note-text"></textarea>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="shared-note-mime" class="field-label"
					>Format <span class="font-normal text-stone-500">(optional)</span></label
				>
				<input
					id="shared-note-mime"
					type="text"
					bind:value={mime}
					class={field}
					placeholder="text/plain"
				/>
			</div>
			<div>
				<label for="shared-note-language" class="field-label"
					>Language <span class="font-normal text-stone-500">(optional)</span></label
				>
				<input
					id="shared-note-language"
					type="text"
					bind:value={language}
					class={field}
					placeholder="en-AU"
				/>
			</div>
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
				disabled={submission.isSaving || !text.trim()}
				class="flex-1 cursor-pointer rounded-lg bg-emerald-800 py-2 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
				>{submission.isSaving ? 'Saving…' : note ? 'Save note' : 'Add note'}</button
			>
		</div>
	</form>
</BaseModal>
