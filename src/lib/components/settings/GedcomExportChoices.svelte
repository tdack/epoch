<script lang="ts">
	import { Download } from '@lucide/svelte';
	import type { GedcomExportChoice } from '#lib/api/files.js';
	import { formatMediaSize } from '#lib/shared/media.js';

	interface Props {
		/** Whether an export is already running, which disables the button. */
		isExporting?: boolean;
		/** Bytes of media the tree stores, or null when the caller cannot see the figure. */
		mediaBytes?: number | null;
		/** Called with the version and packaging chosen. */
		onexport: (choice: GedcomExportChoice) => void;
	}

	let { isExporting = false, mediaBytes = null, onexport }: Props = $props();

	const uid = $props.id();
	let format: GedcomExportChoice['format'] = $state('gedcom7');
	let shouldCompress = $state(false);
	let shouldIncludeMedia = $state(false);

	const formats: { value: GedcomExportChoice['format']; label: string; hint: string }[] = [
		{ value: 'gedcom7', label: 'GEDCOM 7.0', hint: 'The current standard.' },
		{
			value: 'gedcom551',
			label: 'GEDCOM 5.5.1 (legacy)',
			hint: 'For older programs that cannot read 7.0.'
		}
	];
	// GEDZip holds a 7.0 file only, so the option is off, not hidden, with the reason beside it.
	const isGedzipPossible = $derived(format === 'gedcom7');
	// Media is packed inside a .gdz, so it is offered only when that archive is chosen.
	const isMediaPossible = $derived(isGedzipPossible && shouldCompress);
	const mediaNote = $derived(
		mediaBytes === null
			? 'Adds every stored file; may be large.'
			: `Adds ${formatMediaSize(mediaBytes)} of stored files.`
	);

	function chooseFormat(next: GedcomExportChoice['format']) {
		format = next;
		if (next !== 'gedcom7') {
			shouldCompress = false;
			shouldIncludeMedia = false;
		}
	}

	function chooseCompress(isCompressed: boolean) {
		shouldCompress = isCompressed;
		if (!isCompressed) shouldIncludeMedia = false;
	}

	// The flag is absent, not false, when unchecked, so the request omits `includeMedia`.
	function chosen(): GedcomExportChoice {
		return shouldIncludeMedia
			? { format, shouldCompress, shouldIncludeMedia: true }
			: { format, shouldCompress };
	}
</script>

<div class="mt-5 max-w-xl space-y-5">
	<fieldset>
		<legend class="mb-2 text-xs font-semibold text-stone-700">Version</legend>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each formats as f (f.value)}
				<label
					class="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-300 bg-white p-3 transition-colors hover:border-stone-400 has-checked:border-emerald-700 has-checked:bg-emerald-50 has-checked:ring-1 has-checked:ring-emerald-700"
				>
					<input
						type="radio"
						name="{uid}-format"
						value={f.value}
						class="mt-0.5 h-4 w-4 shrink-0 focus-ring"
						checked={format === f.value}
						aria-describedby="{uid}-{f.value}-hint"
						onchange={() => chooseFormat(f.value)}
					/>
					<span class="min-w-0">
						<span class="block text-sm font-semibold text-stone-900">{f.label}</span>
						<span id="{uid}-{f.value}-hint" class="mt-0.5 block text-xs text-stone-600">
							{f.hint}
						</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<label
		class="flex items-center justify-between gap-4 rounded-lg border border-stone-300 bg-white p-3 {isGedzipPossible
			? 'cursor-pointer'
			: 'cursor-not-allowed bg-stone-50'}"
	>
		<span class="min-w-0">
			<span
				class="block text-sm font-semibold {isGedzipPossible ? 'text-stone-900' : 'text-stone-500'}"
				>Compress to .gdz</span
			>
			<span id="{uid}-gdz-note" class="mt-0.5 block text-xs text-stone-600">
				{isGedzipPossible
					? 'Packs the file as a GEDZip archive.'
					: 'GEDZip holds GEDCOM 7.0 files only.'}
			</span>
		</span>
		<input
			type="checkbox"
			checked={shouldCompress}
			onchange={(event) => chooseCompress(event.currentTarget.checked)}
			disabled={!isGedzipPossible}
			aria-describedby="{uid}-gdz-note"
			class="switch"
		/>
	</label>

	<label
		class="flex items-center justify-between gap-4 rounded-lg border border-stone-300 bg-white p-3 {isMediaPossible
			? 'cursor-pointer'
			: 'cursor-not-allowed bg-stone-50'}"
	>
		<span class="min-w-0">
			<span
				class="block text-sm font-semibold {isMediaPossible ? 'text-stone-900' : 'text-stone-500'}"
				>Include media</span
			>
			<span id="{uid}-media-note" class="mt-0.5 block text-xs text-stone-600">
				{isMediaPossible ? mediaNote : 'Needs GEDCOM 7.0 compressed to .gdz.'}
			</span>
			<span id="{uid}-media-hint" class="mt-0.5 block text-xs text-stone-600">
				Files Epoch does not hold are exported as their original references.
			</span>
		</span>
		<input
			type="checkbox"
			bind:checked={shouldIncludeMedia}
			disabled={!isMediaPossible}
			aria-describedby="{uid}-media-note {uid}-media-hint"
			class="switch"
		/>
	</label>
</div>

<button
	type="button"
	disabled={isExporting}
	class="btn-primary mt-5 gap-1.5"
	onclick={() => onexport(chosen())}
>
	<Download class="h-3.5 w-3.5" aria-hidden="true" />
	{isExporting ? 'Exporting…' : 'Export'}
</button>
