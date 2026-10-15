<script lang="ts">
	import { ArrowDown, ArrowUp, MapPin, Plus } from '@lucide/svelte';
	import FactDialog from '#lib/components/modals/FactDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import NotesDisclosure from '#lib/components/notes/NotesDisclosure.svelte';
	import { canAddNote } from '#lib/components/notes/note-permissions.js';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import { deleteFactApi, previewFactApi, reorderFactsApi } from '#lib/services/tree-api.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import { CONFLICT_KINDS } from '#lib/shared/fact-timeline.js';
	import { canCreateRecords, type TreeRole } from '#lib/shared/roles.js';
	import type { FactDto, PersonPageDto } from '#lib/shared/person-page.js';
	import { treePath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
	}

	let { dto, treeId, treeSlug = null, role, editor, toasts }: Props = $props();
	const treeRef = $derived({ id: treeId, slug: treeSlug });
	// A viewer, and the public visitor, may read facts and names but not change them.
	const canEditFacts = $derived(canCreateRecords(role));

	let factDialog = $state<{ fact: FactDto | null } | null>(null);

	/** Event types whose sub-type reads as part of the heading, e.g. "Other event (Anniversary)". */
	const QUALIFIED_TYPES: ReadonlySet<string> = new Set(['EVEN', 'FACT']);
	const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;
	const WEB_URL_SHAPE = /^https?:\/\/\S+$/i;

	interface ContactRow {
		label: string;
		value: string;
		/** Set only for values the browser may follow; anything else renders as plain text. */
		href: string | null;
	}

	/** One row per stored contact value. A `javascript:` or other non-web value is never a link. */
	function contactRows(fact: FactDto): ContactRow[] {
		const rows: ContactRow[] = [];
		const add = (label: string, text: string | null, hrefFor: (value: string) => string | null) => {
			for (const value of (text ?? '').split('\n').map((line) => line.trim())) {
				if (value) rows.push({ label, value, href: hrefFor(value) });
			}
		};
		add('Phone', fact.phone, () => null);
		add('Email', fact.email, (value) => (EMAIL_SHAPE.test(value) ? `mailto:${value}` : null));
		add('Fax', fact.fax, () => null);
		add('Website', fact.web, (value) => (WEB_URL_SHAPE.test(value) ? value : null));
		return rows;
	}

	/** Facts of one kind group together; a custom event's sub-type is part of its kind (ADR-051). */
	function groupKeyOf(fact: FactDto): string {
		return JSON.stringify([fact.type, QUALIFIED_TYPES.has(fact.type) ? fact.classification : null]);
	}

	function groupLabelOf(fact: FactDto): string {
		return (
			fact.label +
			(QUALIFIED_TYPES.has(fact.type) && fact.classification ? ` (${fact.classification})` : '')
		);
	}

	interface Member {
		fact: FactDto;
		/** The fact's place in `dto.facts`, which is what the reorder request sends. */
		index: number;
	}

	interface FactGroup {
		key: string;
		label: string;
		/** Newest first; see `newestFirst`. */
		members: Member[];
		/** Any fact in the group disagrees or repeats another; the group then never collapses. */
		isConflicting: boolean;
	}

	/**
	 * Newest first: a later date first, an undated fact last. Facts that share a date keep the later
	 * one first, so the list reads as the timeline does and the newest shown is the last in the file.
	 */
	function newestFirst(a: Member, b: Member): number {
		const [sa, sb] = [a.fact.sortStart, b.fact.sortStart];
		if (sa !== sb) {
			if (sa === null) return 1;
			if (sb === null) return -1;
			return sa < sb ? 1 : -1;
		}
		return b.index - a.index;
	}

	const groups = $derived.by<FactGroup[]>(() => {
		const byKey = new Map<string, FactGroup>();
		dto.facts.forEach((fact, index) => {
			const key = groupKeyOf(fact);
			let group = byKey.get(key);
			if (!group) {
				group = { key, label: groupLabelOf(fact), members: [], isConflicting: false };
				byKey.set(key, group);
			}
			group.members.push({ fact, index });
			if (fact.conflict) group.isConflicting = true;
		});
		return [...byKey.values()].map((group) => ({
			...group,
			members: [...group.members].sort(newestFirst)
		}));
	});

	/** Which groups show their earlier facts. Kept for the page's life, not stored. */
	let expanded = $state<Record<string, boolean>>({});

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

	/**
	 * The index of the fact a move swaps with, or null. Only facts of one kind and one date swap, since
	 * the list sorts by date. Up is the next index, because a tie shows its later fact first.
	 */
	function swapPartner(index: number, direction: 'up' | 'down'): number | null {
		const partner = direction === 'up' ? index + 1 : index - 1;
		const [a, b] = [dto.facts[index], dto.facts[partner]];
		if (!a || !b) return null;
		return groupKeyOf(a) === groupKeyOf(b) && a.sortStart === b.sortStart ? partner : null;
	}

	async function move(index: number, partner: number) {
		const order = dto.facts.map((f) => f.id);
		[order[index], order[partner]] = [order[partner]!, order[index]!];
		await editor.mutate(() => reorderFactsApi(treeId, dto.person.id, order), {
			done: 'Facts reordered',
			failure: 'Could not reorder'
		});
	}
</script>

{#snippet factRow(fact: FactDto, index: number)}
	<li
		class="py-3"
		data-testid="fact"
		data-fact-id={fact.id}
		data-fact-type={fact.type}
		data-conflict={fact.conflict?.kind ?? ''}
	>
		<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			{#if fact.value}<span class="text-sm text-stone-900">{fact.value}</span>{/if}
			<span class="text-xs text-stone-600"
				>{fact.dateText ?? 'Date unknown'}{#if fact.isApproximate}
					<span class="text-stone-400">(approximate)</span>{/if}</span
			>
		</div>
		{#if fact.place}<p class="mt-1 flex items-center text-xs text-stone-600">
				<MapPin class="mr-1 h-3.5 w-3.5 text-stone-400" /><a
					href={`${treePath(treeRef)}/place?name=${encodeURIComponent(fact.place)}`}
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
		{#if fact.address}<p
				class="mt-1 text-xs whitespace-pre-line text-stone-700"
				data-testid="fact-address"
			>
				{fact.address}
			</p>{/if}
		{#if fact.agency}<p class="mt-1 text-xs text-stone-600" data-testid="fact-agency">
				Agency: {fact.agency}
			</p>{/if}
		{#if fact.religion}<p class="mt-1 text-xs text-stone-600" data-testid="fact-religion">
				Religion: {fact.religion}
			</p>{/if}
		{#if contactRows(fact).length > 0}
			<ul class="mt-1 space-y-0.5 text-xs text-stone-600" data-testid="fact-contact">
				{#each contactRows(fact) as row, rowIndex (rowIndex)}
					<li>
						{row.label}:
						{#if row.href}<a
								href={row.href}
								rel="noopener noreferrer"
								class="text-emerald-800 underline hover:text-emerald-900">{row.value}</a
							>{:else}{row.value}{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if fact.latitude || fact.longitude}<p
				class="mt-1 text-xs text-stone-600"
				data-testid="fact-coordinates"
			>
				Coordinates: {[fact.latitude, fact.longitude].filter(Boolean).join(', ')}
			</p>{/if}
		{#if fact.isLegacyNote && fact.notes}<p class="mt-1 text-xs text-stone-700">
				{fact.notes}
				<span class="text-stone-400">(imported note)</span>
			</p>{/if}
		{#if fact.retainedLines.length > 0}
			<details class="mt-2 text-xs" data-testid="fact-retained">
				<summary class="cursor-pointer font-semibold text-stone-700"
					>Imported, not editable here ({fact.retainedLines.length})</summary
				>
				<p class="mt-1 text-stone-600">
					Kept so your file exports unchanged. The app cannot show or edit these yet.
				</p>
				<pre
					class="mt-1 overflow-x-auto rounded bg-stone-50 p-2 font-mono text-[11px] text-stone-800">{fact.retainedLines.join(
						'\n'
					)}</pre>
			</details>
		{/if}
		{#if fact.conflict}
			<p class="mt-1 text-xs font-semibold text-amber-800" role="note">
				{fact.conflict.kind === 'repeat'
					? `Recorded ${fact.conflict.otherIds.length + 1} times with the same details.`
					: `Disagrees with ${fact.conflict.otherIds.length} other recorded ${fact.label.toLowerCase()}${fact.conflict.otherIds.length > 1 ? 's' : ''}. All are kept.`}
			</p>
		{/if}
		<CitationsDisclosure
			{treeId}
			{treeSlug}
			{role}
			{editor}
			{toasts}
			subjectLabel={`the ${fact.label.toLowerCase()}`}
			subject={{ kind: CITATION_SUBJECT_KINDS.EVENT, id: fact.id }}
			citations={citationsOfSubject(dto.evidence.citations, CITATION_SUBJECT_KINDS.EVENT, fact.id)}
			citationCount={fact.citationCount}
			isConflicting={fact.conflict?.kind === CONFLICT_KINDS.CONFLICT}
			label={`the ${fact.label.toLowerCase()}`}
		>
			{#snippet controls()}
				{#if canEditFacts}
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
					{#if swapPartner(index, 'up') !== null}
						<button
							type="button"
							onclick={() => void move(index, swapPartner(index, 'up')!)}
							class="row-link"
							aria-label={`Move ${fact.label} up`}><ArrowUp class="inline h-3 w-3" /></button
						>
					{/if}
					{#if swapPartner(index, 'down') !== null}
						<button
							type="button"
							onclick={() => void move(index, swapPartner(index, 'down')!)}
							class="row-link"
							aria-label={`Move ${fact.label} down`}><ArrowDown class="inline h-3 w-3" /></button
						>
					{/if}
				{/if}
			{/snippet}
		</CitationsDisclosure>
		<NotesDisclosure
			noteCount={fact.noteItems.length}
			canAdd={canAddNote(role)}
			label={`the ${fact.label.toLowerCase()}`}
		>
			<NoteList
				{treeId}
				{treeSlug}
				{role}
				{editor}
				{toasts}
				subjectLabel={`the ${fact.label.toLowerCase()}`}
				subject={{ kind: NOTE_SUBJECT_KINDS.EVENT, id: fact.id }}
				notes={fact.noteItems}
			/>
		</NotesDisclosure>
	</li>
{/snippet}

{#if canEditFacts}
	<div class="flex justify-end">
		<button type="button" onclick={() => (factDialog = { fact: null })} class="action-btn"
			><Plus class="h-3.5 w-3.5" />Add fact</button
		>
	</div>
{/if}
{#if dto.facts.length === 0}
	<p class="text-sm text-stone-500 italic">No facts recorded.</p>
{:else}
	<ol class="space-y-3" data-testid="facts">
		{#each groups as group, groupIndex (group.key)}
			{@const [newest, ...earlier] = group.members}
			{@const earlierId = `facts-earlier-${groupIndex}`}
			{@const isOpen = expanded[group.key] === true}
			<li class="rounded-xl border border-stone-200 bg-white p-3" data-testid="fact-group">
				<h4 class="flex items-baseline gap-2 text-sm font-semibold text-stone-900">
					{group.label}
					{#if group.members.length > 1}
						<span class="text-xs font-normal text-stone-500">{group.members.length}</span>
					{/if}
				</h4>
				{#if group.isConflicting}
					<ul class="mt-1 divide-y divide-stone-200">
						{#each group.members as member (member.fact.id)}
							{@render factRow(member.fact, member.index)}
						{/each}
					</ul>
				{:else}
					<ul class="mt-1 divide-y divide-stone-200">
						{@render factRow(newest!.fact, newest!.index)}
					</ul>
					{#if earlier.length > 0}
						<button
							type="button"
							class="row-link mt-1 text-xs coarse:min-h-11"
							aria-expanded={isOpen}
							aria-controls={earlierId}
							onclick={() => (expanded[group.key] = !isOpen)}
							>{isOpen ? 'Hide earlier' : `Show ${earlier.length} earlier`}</button
						>
						<ul id={earlierId} class="divide-y divide-stone-200" hidden={!isOpen}>
							{#each earlier as member (member.fact.id)}
								{@render factRow(member.fact, member.index)}
							{/each}
						</ul>
					{/if}
				{/if}
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
