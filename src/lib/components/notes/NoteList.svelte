<script lang="ts">
	import { ArrowDown, ArrowUp, Plus } from '@lucide/svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { previewNoteApi, removeNoteApi, reorderNotesApi, shareNoteApi } from '#lib/api/notes.js';
	import type { NoteDto, NoteSubjectRef } from '#lib/shared/notes.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import NoteDialog from './NoteDialog.svelte';
	import { canAddNote, canChangeNote } from './note-permissions.js';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		/** What these notes are on, in words: "the birth of Ann Ash". */
		subjectLabel: string;
		subject: NoteSubjectRef;
		/** This record's notes, in the order they are kept. */
		notes: NoteDto[];
		editor: TreeEditor;
		toasts: ToastStore;
		/** Leave out the line that says there are no notes, where the caller says so itself. */
		isQuiet?: boolean;
	}

	let {
		treeId,
		treeSlug = null,
		role,
		subjectLabel,
		subject,
		notes,
		editor,
		toasts,
		isQuiet = false
	}: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });

	let dialog = $state<{ note: NoteDto | null } | null>(null);

	const notePath = (id: string) => `${treePath(treeRef)}/notes/${encodeURIComponent(id)}`;

	async function saved(change: Parameters<typeof editor.afterChange>[0]) {
		dialog = null;
		await editor.afterChange(change, 'Note saved');
	}

	async function stale(message: string) {
		dialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the note and try again.`, {
			tone: 'error',
			durationMs: 10_000
		});
	}

	function remove(note: NoteDto) {
		void editor.confirmWithImpact({
			title: note.isShared ? 'Detach this shared note?' : 'Remove this note?',
			confirmLabel: note.isShared ? 'Detach note' : 'Remove note',
			preview: () =>
				previewNoteApi(treeId, {
					kind: 'remove_note',
					attachmentId: note.id,
					version: note.version
				}),
			run: () => removeNoteApi(treeId, note.id, note.version),
			done: note.isShared ? 'Note detached' : 'Note removed'
		});
	}

	async function share(note: NoteDto) {
		await editor.mutate(() => shareNoteApi(treeId, note.id, note.version), {
			done: 'Note shared',
			failure: 'Could not share the note'
		});
	}

	async function move(index: number, by: -1 | 1) {
		const order = notes.map((n) => n.id);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		await editor.mutate(() => reorderNotesApi(treeId, subject, order), {
			done: 'Notes reordered',
			failure: 'Could not reorder'
		});
	}
</script>

{#if notes.length === 0}
	{#if !isQuiet}
		<p class="text-xs text-stone-600 italic" data-testid="no-notes">
			No note on {subjectLabel}.
		</p>
	{/if}
{:else}
	<ol class="space-y-2" data-testid="notes" aria-label={`Notes on ${subjectLabel}`}>
		{#each notes as note, index (note.id)}
			<li class="rounded-lg border border-stone-200 bg-stone-50 p-2 text-xs" data-testid="note">
				<p class="whitespace-pre-line text-stone-800" class:italic={note.isMissing}>{note.text}</p>
				{#if note.isShared && note.noteId}
					<p class="mt-1 text-stone-600" data-testid="note-shared">
						<a href={notePath(note.noteId)} class="text-link"
							>Shared note, used by {note.usedBy}
							{note.usedBy === 1 ? 'record' : 'records'}</a
						>
					</p>
				{/if}
				{#if canChangeNote(role) && !note.isMissing}
					<div class="mt-1.5 flex flex-wrap items-center gap-3 font-semibold">
						<button
							type="button"
							class="row-link"
							onclick={() => (dialog = { note })}
							aria-label={`Edit the note on ${subjectLabel}`}>Edit</button
						>
						{#if !note.isShared}
							<button
								type="button"
								class="row-link"
								onclick={() => void share(note)}
								aria-label={`Share the note on ${subjectLabel}`}>Share</button
							>
						{/if}
						<button
							type="button"
							class="row-link text-red-700"
							onclick={() => remove(note)}
							aria-label={`${note.isShared ? 'Detach' : 'Remove'} the note on ${subjectLabel}`}
							>{note.isShared ? 'Detach' : 'Remove'}</button
						>
						{#if index > 0}
							<button
								type="button"
								class="row-link"
								onclick={() => void move(index, -1)}
								aria-label={`Move the note on ${subjectLabel} up`}
								><ArrowUp class="inline h-3 w-3" /></button
							>
						{/if}
						{#if index < notes.length - 1}
							<button
								type="button"
								class="row-link"
								onclick={() => void move(index, 1)}
								aria-label={`Move the note on ${subjectLabel} down`}
								><ArrowDown class="inline h-3 w-3" /></button
							>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
{#if canAddNote(role)}
	<button
		type="button"
		class="action-btn mt-2"
		onclick={() => (dialog = { note: null })}
		aria-label={`Add a note to ${subjectLabel}`}><Plus class="h-3.5 w-3.5" />Add note</button
	>
{/if}

<NoteDialog
	isOpen={dialog !== null}
	{treeId}
	{subjectLabel}
	{subject}
	note={dialog?.note ?? null}
	onsaved={saved}
	onstale={stale}
	oncancel={() => (dialog = null)}
/>
