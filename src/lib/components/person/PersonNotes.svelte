<script lang="ts">
	import type { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import NoteList from '#lib/components/notes/NoteList.svelte';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { NOTE_SUBJECT_KINDS } from '#lib/shared/notes.js';
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
</script>

<!-- The person's own notes, in place. Notes on a fact, a name or a citation sit beside it in its own section. -->
<NoteList
	{treeId}
	{treeSlug}
	{role}
	{editor}
	{toasts}
	subjectLabel={dto.person.displayName}
	subject={{ kind: NOTE_SUBJECT_KINDS.PERSON, id: dto.person.id }}
	notes={dto.notes}
/>
{#if dto.linkNotes.length > 0}
	<div class="mt-4 space-y-3" data-testid="link-notes">
		{#each dto.linkNotes as link (link.id)}
			<div>
				<h4 class="text-xs font-bold tracking-wider text-stone-700 uppercase">{link.label}</h4>
				<div class="mt-1">
					<NoteList
						{treeId}
						{treeSlug}
						{role}
						{editor}
						{toasts}
						subjectLabel={link.label}
						subject={{ kind: NOTE_SUBJECT_KINDS.PARENT_CHILD, id: link.id }}
						notes={link.notes}
						isQuiet
					/>
				</div>
			</div>
		{/each}
	</div>
{/if}
