<script lang="ts">
	import { Download } from '@lucide/svelte';
	import type { GedcomExportChoice } from '#lib/api/files.js';

	interface Props {
		/** Whether an export is already running, which disables the button. */
		isExporting?: boolean;
		/** Called with the version and packaging chosen. */
		onexport: (choice: GedcomExportChoice) => void;
	}

	let { isExporting = false, onexport }: Props = $props();

	const uid = $props.id();
	let format: GedcomExportChoice['format'] = $state('gedcom7');
	let shouldCompress = $state(false);

	const formats: { value: GedcomExportChoice['format']; label: string }[] = [
		{ value: 'gedcom7', label: 'GEDCOM 7.0' },
		{ value: 'gedcom551', label: 'GEDCOM 5.5.1 (legacy)' }
	];
	// GEDZip holds a 7.0 file only, so the option is off, not hidden, with the reason beside it.
	const isGedzipPossible = $derived(format === 'gedcom7');

	function chooseFormat(next: GedcomExportChoice['format']) {
		format = next;
		if (next !== 'gedcom7') shouldCompress = false;
	}
</script>

<fieldset class="mt-4 space-y-2">
	<legend class="text-sm font-semibold text-stone-800">Version</legend>
	{#each formats as f (f.value)}
		<label class="flex items-center gap-2 text-sm text-stone-800">
			<input
				type="radio"
				name="{uid}-format"
				value={f.value}
				checked={format === f.value}
				onchange={() => chooseFormat(f.value)}
			/>
			{f.label}
		</label>
	{/each}
</fieldset>

<label class="mt-3 flex items-center gap-2 text-sm text-stone-800">
	<input
		type="checkbox"
		bind:checked={shouldCompress}
		disabled={!isGedzipPossible}
		aria-describedby={isGedzipPossible ? undefined : `${uid}-gdz-note`}
	/>
	Compress to .gdz
</label>
{#if !isGedzipPossible}
	<p id="{uid}-gdz-note" class="mt-1 text-xs text-stone-600">GEDZip holds GEDCOM 7.0 files only.</p>
{/if}

<button
	type="button"
	disabled={isExporting}
	class="btn-primary mt-4 gap-1.5"
	onclick={() => onexport({ format, shouldCompress })}
>
	<Download class="h-3.5 w-3.5" aria-hidden="true" />
	{isExporting ? 'Exporting…' : 'Export'}
</button>
