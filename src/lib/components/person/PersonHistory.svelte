<script lang="ts">
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import type { TreeRef } from '#lib/shared/tree-slug.js';
	import ChangeList from './ChangeList.svelte';

	interface Props {
		dto: PersonPageDto;
		tree: TreeRef;
		editor: TreeEditor;
	}

	let { dto, tree, editor }: Props = $props();

	const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'unknown');
</script>

<p class="text-xs text-stone-500">
	Created {when(dto.changes.createdAt)} · last written {when(dto.changes.updatedAt)}
</p>
<ChangeList
	changes={dto.changes.recent}
	recordId={dto.person.id}
	{tree}
	{editor}
	emptyText="No changes are logged for this person. Imported records have no history."
/>
