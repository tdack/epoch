<script lang="ts">
	import { ArrowDown, ArrowUp, Plus } from 'lucide-svelte';
	import NameDialog from '#lib/components/modals/NameDialog.svelte';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import CitationList from '#lib/components/evidence/CitationList.svelte';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import NotesDisclosure from '#lib/components/notes/NotesDisclosure.svelte';
	import { canAddNote } from '#lib/components/notes/note-permissions.js';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
	import CitationsDisclosure from '#lib/components/evidence/CitationsDisclosure.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import { CITATION_SUBJECT_KINDS } from '#lib/shared/evidence.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import {
		deleteNameApi,
		previewNameApi,
		reorderNamesApi,
		setPreferredNameApi
	} from '#lib/services/tree-api.js';
	import { NAME_TYPE_LABELS, formatFullName } from '#lib/shared/name-types.js';
	import type { NameDto, PersonPageDto } from '#lib/shared/person-page.js';
	import { unionPath } from './person-paths.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		role: TreeRole | undefined;
		editor: TreeEditor;
		toasts: ToastStore;
	}

	let { dto, treeId, role, editor, toasts }: Props = $props();

	let nameDialog = $state<{ name: NameDto | null } | null>(null);

	async function nameSaved(change: Parameters<typeof editor.afterChange>[0]) {
		nameDialog = null;
		await editor.afterChange(change, 'Name saved');
	}

	async function nameStale(message: string) {
		nameDialog = null;
		await editor.refresh();
		toasts.push(`${message} Review the name and try again.`, { tone: 'error', durationMs: 10_000 });
	}

	/** The partnerships this person can have taken a name through, worded by who the other partners are. */
	const partnershipChoices = $derived(
		dto.partnerships.map((p) => {
			const others = p.partners
				.filter((partner) => partner.id !== dto.person.id)
				.map((partner) => partner.displayName);
			return {
				unionId: p.unionId,
				label: others.length > 0 ? `Partnership with ${others.join(' and ')}` : 'Partnership'
			};
		})
	);
	const partnershipLabel = (unionId: string | null) =>
		partnershipChoices.find((c) => c.unionId === unionId)?.label ?? null;

	/** A name's own type, or the word the file gave it for a type Epoch has no name for. */
	const typeLabel = (name: NameDto) =>
		name.type === 'other' && name.gedcomType ? name.gedcomType : NAME_TYPE_LABELS[name.type];

	/** "In use from 1998, taken through" (the partnership link follows it); built here because the template drops the space after a comma between blocks. */
	function nameContext(name: NameDto): string {
		const from = name.dateText ? `In use from ${name.dateText}` : '';
		const through = partnershipLabel(name.unionId) ? `${from ? 'taken' : 'Taken'} through` : '';
		return [from, through].filter(Boolean).join(from && through ? ', ' : '');
	}

	function removeName(name: NameDto) {
		if (name.id === null) return;
		const { id, version } = { id: name.id, version: name.version ?? 0 };
		void editor.confirmWithImpact({
			title: `Remove the ${typeLabel(name).toLowerCase()} "${formatFullName(name)}"?`,
			confirmLabel: 'Remove name',
			preview: () => previewNameApi(treeId, { kind: 'delete_name', nameId: id, version }),
			run: () => deleteNameApi(treeId, id, version),
			done: 'Name removed'
		});
	}

	async function makePreferred(name: NameDto) {
		if (name.id === null) return;
		const nameId = name.id;
		await editor.mutate(
			() => setPreferredNameApi(treeId, dto.person.id, nameId, name.version ?? undefined),
			{ done: 'Preferred name changed', failure: 'Could not change the preferred name' }
		);
	}

	/** The preferred name is always listed and exported first, so it cannot move and nothing can move above it. */
	const canMoveName = (index: number, by: -1 | 1) => {
		const other = dto.names[index + by];
		return other !== undefined && !other.isPreferred && !dto.names[index]!.isPreferred;
	};

	async function moveName(index: number, by: -1 | 1) {
		const order = dto.names.map((n) => n.id).filter((id): id is string => id !== null);
		[order[index], order[index + by]] = [order[index + by]!, order[index]!];
		await editor.mutate(() => reorderNamesApi(treeId, dto.person.id, order), {
			done: 'Names reordered',
			failure: 'Could not reorder'
		});
	}
</script>

<div class="flex justify-end">
	<button type="button" onclick={() => (nameDialog = { name: null })} class="action-btn"
		><Plus class="h-3.5 w-3.5" />Add name</button
	>
</div>
<ol class="space-y-2" data-testid="names">
	{#each dto.names as name, index (name.id ?? 'derived')}
		<li
			class="rounded-xl border border-stone-200 bg-white p-3"
			data-testid="name"
			data-name-type={name.type}
			data-preferred={name.isPreferred}
		>
			<div class="flex flex-wrap items-baseline justify-between gap-x-3">
				<span class="text-sm font-semibold text-stone-900"
					>{name.displayName}{#if name.nickname}
						<span class="font-normal text-stone-600">“{name.nickname}”</span>{/if}</span
				>
				<span class="text-xs text-stone-600">
					{typeLabel(name)}{#if name.isPreferred}
						· <span class="font-semibold text-emerald-800">shown as</span>{/if}
				</span>
			</div>
			{#if name.dateText || partnershipLabel(name.unionId)}
				<p class="mt-1 text-xs text-stone-600" data-testid="name-context">
					{nameContext(name)}{#if partnershipLabel(name.unionId)}{' '}<a
							href={unionPath(treeId, name.unionId!)}
							class="text-link">{partnershipLabel(name.unionId)}</a
						>{/if}
				</p>
			{/if}
			{#if name.id !== null}
				<CitationsDisclosure
					citationCount={name.citationCount}
					label={`the ${typeLabel(name).toLowerCase()} ${name.displayName}`}
				>
					<CitationList
						{treeId}
						{role}
						{editor}
						{toasts}
						subjectLabel={`the ${typeLabel(name).toLowerCase()} ${name.displayName}`}
						subject={{ kind: CITATION_SUBJECT_KINDS.NAME, id: name.id }}
						citations={citationsOfSubject(
							dto.evidence.citations,
							CITATION_SUBJECT_KINDS.NAME,
							name.id
						)}
					/>
				</CitationsDisclosure>
				<NotesDisclosure
					noteCount={name.notes.length}
					canAdd={canAddNote(role)}
					label={`the ${typeLabel(name).toLowerCase()} ${name.displayName}`}
				>
					<NoteList
						{treeId}
						{role}
						{editor}
						{toasts}
						subjectLabel={`the ${typeLabel(name).toLowerCase()} ${name.displayName}`}
						subject={{ kind: NOTE_SUBJECT_KINDS.NAME, id: name.id }}
						notes={name.notes}
					/>
				</NotesDisclosure>
				<div class="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
					<button
						type="button"
						onclick={() => (nameDialog = { name })}
						class="row-link"
						aria-label={`Edit ${typeLabel(name)}`}>Edit</button
					>
					{#if !name.isPreferred}
						<button
							type="button"
							onclick={() => void makePreferred(name)}
							class="row-link"
							aria-label={`Show as ${name.displayName}`}>Show as this name</button
						>
					{/if}
					{#if dto.names.length > 1}
						<button
							type="button"
							onclick={() => removeName(name)}
							class="row-link text-red-700"
							aria-label={`Remove ${typeLabel(name)}`}>Remove</button
						>
					{/if}
					{#if canMoveName(index, -1)}
						<button
							type="button"
							onclick={() => void moveName(index, -1)}
							class="row-link"
							aria-label={`Move ${typeLabel(name)} up`}><ArrowUp class="inline h-3 w-3" /></button
						>
					{/if}
					{#if canMoveName(index, 1)}
						<button
							type="button"
							onclick={() => void moveName(index, 1)}
							class="row-link"
							aria-label={`Move ${typeLabel(name)} down`}
							><ArrowDown class="inline h-3 w-3" /></button
						>
					{/if}
				</div>
			{:else}
				<p class="mt-1 text-xs text-stone-500">Edit this name from the person's Edit button.</p>
			{/if}
		</li>
	{/each}
</ol>

<NameDialog
	isOpen={nameDialog !== null}
	{treeId}
	personId={dto.person.id}
	name={nameDialog?.name ?? null}
	partnerships={partnershipChoices}
	onsaved={nameSaved}
	onstale={nameStale}
	oncancel={() => (nameDialog = null)}
/>
