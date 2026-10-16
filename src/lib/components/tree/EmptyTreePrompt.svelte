<script lang="ts">
	import { Upload } from '@lucide/svelte';
	import { GEDCOM_FILE_ACCEPT, isGedcomFileName } from '#lib/shared/gedcom-files.js';

	interface Props {
		/** May add a person: shows "Add the first person". */
		canCreate: boolean;
		/** May import a GEDCOM file into this tree: shows the import button and takes a dropped file. */
		canImport: boolean;
		onAddPerson: () => void;
		/** A GEDCOM file was chosen or dropped; the caller previews it and asks before importing. */
		onImport: (file: File) => void;
		/** A dropped file was not GEDCOM, or more than one was dropped; the message says which. */
		onReject: (message: string) => void;
	}

	let { canCreate, canImport, onAddPerson, onImport, onReject }: Props = $props();

	let fileInput: HTMLInputElement | undefined = $state();
	/** A drag is over the panel; counted because entering a child fires leave on the parent. */
	let dragDepth = $state(0);
	const isDragOver = $derived(dragDepth > 0);

	/** Only file drags are for us; a dragged link or text passes over without a highlight. */
	const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

	function take(files: FileList | null | undefined) {
		if (!files || files.length === 0) return;
		if (files.length > 1) return onReject('Drop one GEDCOM file at a time.');
		const file = files[0]!;
		if (!isGedcomFileName(file.name))
			return onReject(`${file.name} is not a GEDCOM file (.ged, .gedcom or .gdz).`);
		onImport(file);
	}
</script>

<!-- The whole panel is the drop target, so a file let go anywhere on it is taken. -->
<div
	class="flex flex-1 flex-col items-center justify-center rounded-2xl border-2 p-10 text-center transition-colors {isDragOver
		? 'border-dashed border-emerald-700 bg-emerald-50'
		: 'border-stone-200 bg-stone-100/60'}"
	role="region"
	aria-label="Empty tree"
	data-testid="empty-tree"
	ondragenter={(event) => {
		if (!canImport || !isFileDrag(event)) return;
		event.preventDefault();
		dragDepth += 1;
	}}
	ondragover={(event) => {
		if (!canImport || !isFileDrag(event)) return;
		// Without this the browser opens the file instead of dropping it here.
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
	}}
	ondragleave={() => {
		if (dragDepth > 0) dragDepth -= 1;
	}}
	ondrop={(event) => {
		if (!canImport || !isFileDrag(event)) return;
		event.preventDefault();
		dragDepth = 0;
		take(event.dataTransfer?.files);
	}}
>
	<p class="text-sm text-stone-700">This tree has no people yet.</p>
	{#if canCreate || canImport}
		<div class="mt-4 flex flex-wrap justify-center gap-3">
			{#if canCreate}
				<button type="button" onclick={onAddPerson} class="btn-primary focus-ring coarse:min-h-11">
					Add the first person
				</button>
			{/if}
			{#if canImport}
				<button
					type="button"
					onclick={() => fileInput?.click()}
					class="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 focus-ring hover:bg-stone-50 coarse:min-h-11"
				>
					<Upload class="h-4 w-4" aria-hidden="true" />
					Upload GEDCOM
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept={GEDCOM_FILE_ACCEPT}
					class="hidden"
					tabindex="-1"
					aria-label="GEDCOM file to upload"
					onchange={(event) => {
						take(event.currentTarget.files);
						// Cleared so choosing the same file again still fires a change.
						event.currentTarget.value = '';
					}}
				/>
			{/if}
		</div>
		{#if canImport}
			<p class="mt-3 text-xs text-stone-600">
				{isDragOver ? 'Let go to upload it' : 'Or drop a GEDCOM file here'}
			</p>
		{/if}
	{/if}
</div>
