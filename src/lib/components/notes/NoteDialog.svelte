<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { StickyNote } from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import { isConflict } from '#lib/api/client.js';
	import {
		addNoteApi,
		attachNoteApi,
		fetchNotes,
		updateNoteApi,
		updateSharedNoteApi
	} from '#lib/api/notes.js';
	import type { NoteDto, NoteListItem, NoteSubjectRef } from '#lib/shared/notes.js';
	import type { ChangeSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** What the note is on, in words, for the dialog's subtitle ("the birth of Ann Ash"). */
		subjectLabel: string;
		subject: NoteSubjectRef;
		/** The note being edited, or null to add one. */
		note: NoteDto | null;
		/** Called after a save, with the change so the caller can offer Undo. */
		onsaved: (change: ChangeSummary | null) => void | Promise<void>;
		/** Called when the note changed under the editor; the caller reloads. */
		onstale: (message: string) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, subjectLabel, subject, note, onsaved, onstale, oncancel }: Props = $props();

	const SEARCH_DELAY_MS = 250;
	const RESULTS_SHOWN = 8;

	/** Writing new words, or choosing a note others already use. */
	let mode = $state<'write' | 'choose'>('write');
	let text = $state('');
	let mime = $state('');
	let language = $state('');
	let query = $state('');
	let results = $state<NoteListItem[]>([]);
	let error = $state<string | null>(null);
	let isSaving = $state(false);
	let textArea = $state<HTMLTextAreaElement | null>(null);

	const isShared = $derived(note?.isShared ?? false);
	const field =
		'w-full bg-stone-50 border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600';

	// Filled when the dialog opens only: reading `note` inside an effect that also watches the fields
	// would wipe what has been typed whenever the page data reloads underneath it.
	$effect(() => {
		if (!isOpen) return;
		const from = untrack(() => note);
		mode = 'write';
		text = from?.text ?? '';
		mime = from?.mime ?? '';
		language = from?.language ?? '';
		query = '';
		results = [];
		error = null;
		void tick().then(() => textArea?.focus());
	});

	// Shared notes matching what is typed, a few at a time: the tree may hold thousands.
	$effect(() => {
		const typed = query.trim();
		if (!isOpen || mode !== 'choose') return;
		const timer = setTimeout(async () => {
			try {
				const found = await fetchNotes(
					treeId,
					new URLSearchParams({ q: typed, limit: String(RESULTS_SHOWN) })
				);
				results = found.items;
			} catch {
				results = [];
			}
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	async function attach(chosen: NoteListItem) {
		isSaving = true;
		error = null;
		try {
			const { change } = await attachNoteApi(treeId, subject, chosen.id);
			await onsaved(change);
		} catch (cause: unknown) {
			error = messageOf(cause, 'Could not attach the note');
		} finally {
			isSaving = false;
		}
	}

	async function save() {
		const words = text.trim();
		if (!words) {
			error = 'A note needs some text.';
			return;
		}
		isSaving = true;
		error = null;
		try {
			const { change } = note
				? note.isShared
					? await updateSharedNoteApi(
							treeId,
							note.noteId!,
							{ text: words, mime: mime.trim() || null, language: language.trim() || null },
							note.noteVersion!
						)
					: await updateNoteApi(treeId, note.id, words, note.version)
				: await addNoteApi(treeId, subject, words);
			await onsaved(change);
		} catch (cause: unknown) {
			if (isConflict(cause)) await onstale(cause.message);
			else error = messageOf(cause, 'Could not save the note');
		} finally {
			isSaving = false;
		}
	}
</script>

<BaseModal
	{isOpen}
	title={note ? (isShared ? 'Edit shared note' : 'Edit note') : 'Add a note'}
	subtitle={`On ${subjectLabel}`}
	icon={StickyNote}
	maxWidthClass="max-w-lg"
	{error}
	onclose={oncancel}
>
	{#if !note}
		<div
			class="mb-3 flex gap-1 text-sm font-semibold"
			role="tablist"
			aria-label="How to add the note"
		>
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'write'}
				class="rounded-lg px-3 py-1 {mode === 'write'
					? 'bg-emerald-800 text-white'
					: 'bg-stone-200 text-stone-700'}"
				onclick={() => (mode = 'write')}>Write a note</button
			>
			<button
				type="button"
				role="tab"
				aria-selected={mode === 'choose'}
				class="rounded-lg px-3 py-1 {mode === 'choose'
					? 'bg-emerald-800 text-white'
					: 'bg-stone-200 text-stone-700'}"
				onclick={() => (mode = 'choose')}>Use a shared note</button
			>
		</div>
	{/if}

	{#if mode === 'choose' && !note}
		<div class="space-y-2" data-testid="note-chooser">
			<label for="note-search" class="sr-only">Search shared notes by their words</label>
			<input
				id="note-search"
				type="search"
				bind:value={query}
				autocomplete="off"
				class={field}
				placeholder="Search shared notes"
			/>
			{#if results.length > 0}
				<ul
					class="max-h-48 divide-y divide-stone-200 overflow-y-auto rounded-lg border border-stone-300 bg-white text-sm"
					aria-label="Matching shared notes"
					data-testid="note-results"
				>
					{#each results as result (result.id)}
						<li>
							<button
								type="button"
								disabled={isSaving}
								class="w-full cursor-pointer px-3 py-1.5 text-left hover:bg-emerald-50"
								onclick={() => void attach(result)}
							>
								<span class="font-semibold text-stone-900">{result.title}</span>
								<span class="text-xs text-stone-600">
									· used by {result.useCount}
									{result.useCount === 1 ? 'record' : 'records'}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			{:else if query.trim()}
				<p class="text-xs text-stone-600">No shared note matches.</p>
			{/if}
			<div class="flex pt-1">
				<button
					type="button"
					onclick={oncancel}
					class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
					>Cancel</button
				>
			</div>
		</div>
	{:else}
		<form
			class="space-y-3"
			data-testid="note-form"
			onsubmit={(event) => {
				event.preventDefault();
				void save();
			}}
		>
			{#if isShared && note}
				<p class="text-xs text-amber-900" role="note">
					This note is shared by {note.usedBy}
					{note.usedBy === 1 ? 'record' : 'records'}; changing it changes it for all of them.
				</p>
			{/if}
			<div>
				<label for="note-text" class="field-label">Note</label>
				<textarea
					id="note-text"
					rows="6"
					bind:this={textArea}
					bind:value={text}
					class={field}
					data-testid="note-text"></textarea>
			</div>
			{#if isShared}
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="note-mime" class="field-label"
							>Format <span class="font-normal text-stone-500">(optional)</span></label
						>
						<input
							id="note-mime"
							type="text"
							bind:value={mime}
							class={field}
							placeholder="text/plain"
						/>
					</div>
					<div>
						<label for="note-language" class="field-label"
							>Language <span class="font-normal text-stone-500">(optional)</span></label
						>
						<input
							id="note-language"
							type="text"
							bind:value={language}
							class={field}
							placeholder="en-AU"
						/>
					</div>
				</div>
			{/if}
			<div class="flex gap-2 pt-1">
				<button
					type="button"
					onclick={oncancel}
					class="flex-1 cursor-pointer rounded-lg bg-stone-200 py-2 font-semibold text-stone-700 hover:bg-stone-300"
					>Cancel</button
				>
				<button type="submit" disabled={isSaving || !text.trim()} class="btn-primary flex-1"
					>{isSaving ? 'Saving…' : note ? 'Save note' : 'Add note'}</button
				>
			</div>
		</form>
	{/if}
</BaseModal>
