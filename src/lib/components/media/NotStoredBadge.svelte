<script lang="ts">
	import { FileX } from '@lucide/svelte';

	// Text as well as an icon, so the state is never carried by colour or a glyph alone.
</script>

<span
	data-testid="not-stored-badge"
	class="inline-flex items-center gap-1 rounded-full border border-dashed border-stone-400 bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-800"
>
	<FileX class="h-3 w-3" aria-hidden="true" />
	Not stored in Epoch
</span>
