<script lang="ts">
	import CitationList from '#lib/components/evidence/CitationList.svelte';
	import { citationsOfSubject } from '#lib/components/evidence/evidence-select.js';
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { CITATION_SUBJECT_KINDS, type CitationSubjectRef } from '#lib/shared/evidence.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';
	import type { TreeRole } from '#lib/shared/roles.js';

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

	interface Group {
		subject: CitationSubjectRef;
		label: string;
	}

	/**
	 * Everything the person has that a source can support, in the order the page shows it: the person,
	 * each name, each fact, each parent link. A group is listed even with no citation, so an unsourced
	 * claim reads as unsourced and has a place to add one.
	 */
	const groups = $derived<Group[]>([
		{
			subject: { kind: CITATION_SUBJECT_KINDS.PERSON, id: dto.person.id },
			label: dto.person.displayName
		},
		...dto.names.flatMap((n) =>
			n.id
				? [
						{
							subject: { kind: CITATION_SUBJECT_KINDS.NAME, id: n.id },
							label: `the name ${n.displayName}`
						}
					]
				: []
		),
		...dto.facts.map((f) => ({
			subject: { kind: CITATION_SUBJECT_KINDS.EVENT, id: f.id },
			label: `the ${f.label.toLowerCase()}${f.dateText ? ` (${f.dateText})` : ''}`
		})),
		...dto.evidence.links.map((l) => ({
			subject: { kind: CITATION_SUBJECT_KINDS.PARENT_CHILD, id: l.id },
			label: l.label
		}))
	]);

	const total = $derived(dto.evidence.citations.length);
</script>

<p class="text-xs text-stone-600" data-testid="evidence-summary">
	{total === 0
		? 'No source is cited for this person yet.'
		: `${total} ${total === 1 ? 'citation' : 'citations'} across what is recorded about them.`}
</p>
<ul class="space-y-3" data-testid="evidence">
	{#each groups as group (group.subject.kind + group.subject.id)}
		{@const citations = citationsOfSubject(
			dto.evidence.citations,
			group.subject.kind,
			group.subject.id
		)}
		<li>
			<h4 class="text-xs font-bold tracking-wider text-stone-700 uppercase">
				{group.label}
				<span class="font-normal tracking-normal text-stone-500 normal-case"
					>· {citations.length === 0
						? 'unsourced'
						: `${citations.length} ${citations.length === 1 ? 'citation' : 'citations'}`}</span
				>
			</h4>
			<div class="mt-1">
				<CitationList
					{treeId}
					{treeSlug}
					{role}
					{editor}
					{toasts}
					subjectLabel={group.label}
					subject={group.subject}
					{citations}
				/>
			</div>
		</li>
	{/each}
</ul>
