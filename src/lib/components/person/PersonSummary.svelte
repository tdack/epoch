<script lang="ts">
	import { sexLabel } from '#lib/shared/sex.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
	}

	let { dto }: Props = $props();
</script>

<div>
	<h2 class="text-2xl font-bold text-stone-900" data-testid="person-name">
		{dto.person.displayName}
	</h2>
	<p class="mt-1 text-sm text-stone-600">
		{sexLabel(dto.person.sex)}{#if dto.vitals.lifespan}<span aria-hidden="true"> · </span><span
				data-testid="lifespan">{dto.vitals.lifespan}</span
			>{/if}
		{#if dto.vitals.hasConflict}<span
				class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900"
				>dates disagree</span
			>{/if}
	</p>
</div>
