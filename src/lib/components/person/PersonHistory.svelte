<script lang="ts">
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
	}

	let { dto }: Props = $props();

	const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'unknown');
</script>

<p class="text-xs text-stone-500">
	Created {when(dto.changes.createdAt)} · last written {when(dto.changes.updatedAt)}
</p>
{#if dto.changes.recent.length === 0}
	<p class="mt-2 text-xs text-stone-500 italic">
		No changes are logged for this person. Imported records have no history.
	</p>
{:else}
	<ul class="mt-2 space-y-1.5 text-xs" data-testid="history">
		{#each dto.changes.recent as change (change.id)}
			<li>
				<span class="font-medium text-stone-800">{change.summary}</span>
				<span class="block text-stone-500"
					>{change.actorName ?? 'Someone'} · {when(change.createdAt)}</span
				>
			</li>
		{/each}
	</ul>
{/if}
