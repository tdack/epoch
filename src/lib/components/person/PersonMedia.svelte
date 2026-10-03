<script lang="ts">
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
	}

	let { dto }: Props = $props();
</script>

{#if dto.media.length > 0}
	<section aria-labelledby="media-heading" class="section-card">
		<h3 id="media-heading" class="section-heading">Media</h3>
		<ul class="mt-2 space-y-1 text-sm">
			{#each dto.media as item (item.id)}
				<li>
					<a
						class="row-link"
						href={`/api/media/${item.r2ObjectKey}`}
						target="_blank"
						rel="noreferrer">{item.title ?? item.r2ObjectKey}</a
					>
				</li>
			{/each}
		</ul>
	</section>
{/if}
