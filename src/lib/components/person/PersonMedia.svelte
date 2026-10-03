<script lang="ts">
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
	}

	let { dto }: Props = $props();
</script>

{#if dto.media.length === 0}
	<p class="text-xs text-stone-500 italic">No photos or documents attached.</p>
{:else}
	<ul class="space-y-1 text-sm">
		{#each dto.media as item (item.id)}
			<li>
				<a class="row-link" href={`/api/media/${item.r2ObjectKey}`} target="_blank" rel="noreferrer"
					>{item.title ?? item.r2ObjectKey}</a
				>
			</li>
		{/each}
	</ul>
{/if}
