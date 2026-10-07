<script lang="ts">
	import { ArrowDown, ArrowUp, MapPin, Plus } from '@lucide/svelte';
	import FactDialog from '#lib/components/modals/FactDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import CitationList from '#lib/components/evidence/CitationList.svelte';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import NotesDisclosure from '#lib/components/notes/NotesDisclosure.svelte';
	import { canAddNote } from '#lib/components/notes/note-permissions.js';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import { deleteFactApi, previewFactApi, reorderFactsApi } from '#lib/services/tree-api.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import { CONFLICT_KINDS } from '#lib/shared/fact-timeline.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import type { FactDto, PersonPageDto } from '#lib/shared/person-page.js';
	import { treePath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
	}

	let { dto, treeId, role, editor, toasts }: Props = $props();

	let factDialog = $state<{ fact: FactDto | null } | null>(null);

	async function factSaved(change: Parameters<typeof editor.afterChange>[0]) {
		factDialog = null;
		await editor.afterChange(change, 'Fact saved');
	}

	async function factStale(message: string) {
		factDialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the fact and try again.`, { tone: 'error', durationMs: 10_000 });
	}

	function removeFact(fact: FactDto) {
		void editor.confirmWithImpact({
			title: `Remove this ${fact.label.toLowerCase()}?`,
			confirmLabel: 'Remove fact',
			preview: () =>
				previewFactApi(treeId, { kind: 'delete_fact', factId: fact.id, version: fact.version }),
			run: () => deleteFactApi(treeId, fact.id, fact.version),
			done: 'Fact removed'
		});
	}

	/** Facts that sort together (same date, or both undated) can swap places; a date decides the rest. */
	const canSwap = (a: FactDto | undefined, b: FactDto | undefined) =>
		a !== undefined && b !== undefined && a.sortStart === b.sortStart;

	async function move(index: number, by: -1 | 1) {
		const order = dto.facts.map((f) => f.id);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		await editor.mutate(() => reorderFactsApi(treeId, dto.person.id, order), {
			done: 'Facts reordered',
			failure: 'Could not reorder'
		});
	}
</script>

<div class="flex justify-end">
	<button type="button" onclick={() => (factDialog = { fact: null })} class="action-btn"
		><Plus class="h-3.5 w-3.5" />Add fact</button
	>
</div>
{#if dto.facts.length === 0}
	<p class="text-sm text-stone-500 italic">No facts recorded.</p>
{:else}
	<ol class="space-y-2" data-testid="facts">
		{#each dto.facts as fact, index (fact.id)}
			<li
				class="rounded-xl border bg-white p-3 {fact.conflict
					? 'border-amber-400'
					: 'border-stone-200'}"
				data-testid="fact"
				data-fact-type={fact.type}
				data-conflict={fact.conflict?.kind ?? ''}
			>
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<span class="text-sm font-semibold text-emerald-900"
						>{fact.label}{#if fact.value}: <span class="text-stone-900">{fact.value}</span
							>{/if}</span
					>
					<span class="text-xs text-stone-600"
						>{fact.dateText ?? 'Date unknown'}{#if fact.isApproximate}
							<span class="text-stone-400">(approximate)</span>{/if}</span
					>
				</div>
				{#if fact.place}<p class="mt-1 flex items-center text-xs text-stone-600">
						<MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" /><a
							href={`${treePath(treeId)}/place?name=${encodeURIComponent(fact.place)}`}
							class="hover:underline">{fact.place}</a
						>
					</p>{/if}
				{#if fact.cause || fact.age}
					<p class="mt-1 text-xs text-stone-600">
						{[fact.cause && `Cause: ${fact.cause}`, fact.age && `Age: ${fact.age}`]
							.filter(Boolean)
							.join(' · ')}
					</p>
				{/if}
				{#if fact.isLegacyNote && fact.notes}<p class="mt-1 text-xs text-stone-700">
						{fact.notes}
						<span class="text-stone-400">(imported note)</span>
					</p>{/if}
				{#if fact.conflict}
					<p class="mt-1 text-xs font-semibold text-amber-800" role="note">
						{fact.conflict.kind === 'repeat'
							? `Recorded ${fact.conflict.otherIds.length + 1} times with the same details.`
							: `Disagrees with ${fact.conflict.otherIds.length} other recorded ${fact.label.toLowerCase()}${fact.conflict.otherIds.length > 1 ? 's' : ''}. All are kept.`}
					</p>
				{/if}
				<CitationsDisclosure
					citationCount={fact.citationCount}
					isConflicting={fact.conflict?.kind === CONFLICT_KINDS.CONFLICT}
					label={`the ${fact.label.toLowerCase()}`}
				>
					<CitationList
						{treeId}
						{role}
						{editor}
						{toasts}
						subjectLabel={`the ${fact.label.toLowerCase()}`}
						subject={{ kind: CITATION_SUBJECT_KINDS.EVENT, id: fact.id }}
						citations={citationsOfSubject(
							dto.evidence.citations,
							CITATION_SUBJECT_KINDS.EVENT,
							fact.id
						)}
					/>
				</CitationsDisclosure>
				<NotesDisclosure
					noteCount={fact.noteItems.length}
					canAdd={canAddNote(role)}
					label={`the ${fact.label.toLowerCase()}`}
				>
					<NoteList
						{treeId}
						{role}
						{editor}
						{toasts}
						subjectLabel={`the ${fact.label.toLowerCase()}`}
						subject={{ kind: NOTE_SUBJECT_KINDS.EVENT, id: fact.id }}
						notes={fact.noteItems}
					/>
				</NotesDisclosure>
				<div class="mt-2 flex items-center gap-3 text-xs font-semibold">
					<button
						type="button"
						onclick={() => (factDialog = { fact })}
						class="row-link"
						aria-label={`Edit ${fact.label}`}>Edit</button
					>
					<button
						type="button"
						onclick={() => removeFact(fact)}
						class="row-link text-red-700"
						aria-label={`Remove ${fact.label}`}>Remove</button
					>
					{#if canSwap(dto.facts[index - 1], fact)}
						<button
							type="button"
							onclick={() => void move(index, -1)}
							class="row-link"
							aria-label={`Move ${fact.label} up`}><ArrowUp class="inline h-3 w-3" /></button
						>
					{/if}
					{#if canSwap(fact, dto.facts[index + 1])}
						<button
							type="button"
							onclick={() => void move(index, 1)}
							class="row-link"
							aria-label={`Move ${fact.label} down`}><ArrowDown class="inline h-3 w-3" /></button
						>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
{/if}

<FactDialog
	isOpen={factDialog !== null}
	{treeId}
	personId={dto.person.id}
	fact={factDialog?.fact ?? null}
	onsaved={factSaved}
	onstale={factStale}
	oncancel={() => (factDialog = null)}
/>
