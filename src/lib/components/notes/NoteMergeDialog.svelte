<script lang="ts">
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import ImpactDialog from '#lib/components/modals/ImpactDialog.svelte';
	import { fetchNotes, mergeNotesApi, previewNoteApi } from '#lib/api/tree-api.js';
	import type { NoteListItem } from '#lib/shared/notes.js';
	import type { ChangeSummary, ImpactSummary } from '#lib/types/genealogy.js';

	interface Props {
		isOpen: boolean;
		treeId: string;
		/** The note that remains; the ones chosen here are folded into it. */
		survivor: { id: string; version: number; label: string };
		onmerged: (change: ChangeSummary | null) => void | Promise<void>;
		oncancel: () => void;
	}

	let { isOpen, treeId, survivor, onmerged, oncancel }: Props = $props();

	const SEARCH_DELAY_MS = 250;

	let query = $state('');
	let found = $state<NoteListItem[]>([]);
	let chosen = $state<NoteListItem[]>([]);
	let impact = $state<ImpactSummary | null>(null);
	let error = $state<string | null>(null);
	let isMerging = $state(false);
	let request = 0;

	const chosenIds = $derived(chosen.map((s) => s.id));
	const labelOf = (s: NoteListItem) => s.title;

	$effect(() => {
		if (!isOpen) return;
		untrack(() => {
			query = '';
			found = [];
			chosen = [];
			impact = null;
			error = null;
		});
	});

	// Notes that could be the same one, a few at a time.
	$effect(() => {
		const typed = query.trim();
		if (!isOpen) return;
		const timer = setTimeout(async () => {
			try {
				const page = await fetchNotes(treeId, new URLSearchParams({ q: typed, limit: '10' }));
				found = page.items.filter((s) => s.id !== survivor.id);
			} catch {
				found = [];
			}
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(timer);
	});

	// What the merge would write, planned on the server.
	$effect(() => {
		const ids = chosenIds;
		if (!isOpen || ids.length === 0) {
			impact = null;
			return;
		}
		const mine = ++request;
		void previewNoteApi(treeId, {
			kind: 'merge_notes',
			survivorId: survivor.id,
			mergedIds: ids
		})
			.then((next) => {
				if (mine !== request) return;
				impact = next;
				error = null;
			})
			.catch((cause: Error) => {
				if (mine !== request) return;
				impact = null;
				error = cause.message;
			});
	});

	function toggle(note: NoteListItem) {
		chosen = chosen.some((s) => s.id === note.id)
			? chosen.filter((s) => s.id !== note.id)
			: [...chosen, note];
	}

	async function merge() {
		isMerging = true;
		error = null;
		try {
			const { change } = await mergeNotesApi(treeId, survivor.id, {
				mergedIds: chosenIds,
				expectedVersions: { [survivor.id]: survivor.version }
			});
			await onmerged(change);
		} catch (cause: unknown) {
			error = messageOf(cause, 'Could not merge the notes');
		} finally {
			isMerging = false;
		}
	}
</script>

<ImpactDialog
	{isOpen}
	title={`Merge shared notes into “${survivor.label}”`}
	{impact}
	isLoading={isOpen && chosen.length > 0 && impact === null && error === null}
	isConfirming={isMerging}
	{error}
	confirmLabel="Merge notes"
	idleMessage="Choose the duplicate notes to fold into this one."
	isConfirmBlocked={chosen.length === 0}
	onconfirm={merge}
	{oncancel}
>
	{#snippet controls()}
		<div class="space-y-2">
			<label for="merge-note-search" class="field-label">Find the duplicates</label>
			<input
				id="merge-note-search"
				type="search"
				bind:value={query}
				autocomplete="off"
				class="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm"
				placeholder="Words of the note"
			/>
			<ul
				class="max-h-40 divide-y divide-stone-200 overflow-y-auto rounded-lg border border-stone-300 bg-white text-sm"
				aria-label="Notes to merge in"
			>
				{#each found as note (note.id)}
					<li>
						<label class="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-emerald-50">
							<input
								type="checkbox"
								checked={chosenIds.includes(note.id)}
								onchange={() => toggle(note)}
							/>
							<span class="font-semibold">{labelOf(note)}</span>
							<span class="text-xs text-stone-600"
								>{note.useCount} {note.useCount === 1 ? 'use' : 'uses'}</span
							>
						</label>
					</li>
				{/each}
			</ul>
		</div>
	{/snippet}
</ImpactDialog>
