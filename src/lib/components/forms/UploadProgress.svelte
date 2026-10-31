<script lang="ts">
	import { formatMediaSize } from '#lib/shared/media.js';

	interface Props {
		/** The file being sent, named so a screen reader knows what the bar measures. */
		fileName: string;
		/** Bytes delivered so far. */
		uploadedBytes: number;
		/** Size of the whole file, in bytes. */
		totalBytes: number;
		/** What the upload is doing: sending parts, being filed, or stopped by `error`. */
		phase: 'uploading' | 'finishing' | 'failed';
		/** A sentence for the person; shown only in the `failed` phase. */
		error?: string | null;
		/** Stops the upload. Offered only while it is running. */
		oncancel: () => void;
		/** Tries again from where it stopped. Offered only after a failure. */
		onretry: () => void;
	}

	let {
		fileName,
		uploadedBytes,
		totalBytes,
		phase,
		error = null,
		oncancel,
		onretry
	}: Props = $props();

	const percent = $derived(
		totalBytes > 0 ? Math.min(100, Math.floor((uploadedBytes / totalBytes) * 100)) : 0
	);
	const sizes = $derived(`${formatMediaSize(uploadedBytes)} of ${formatMediaSize(totalBytes)}`);

	let retryButton = $state<HTMLButtonElement | null>(null);
	// The failure replaces the controls the person was using, so focus moves to what they can do next.
	$effect(() => {
		if (phase === 'failed') retryButton?.focus();
	});
</script>

<div class="space-y-2" data-testid="upload-progress">
	{#if phase === 'failed'}
		<p role="alert" class="text-xs font-medium text-red-700" data-testid="upload-error">
			{error ?? 'The upload stopped.'}
		</p>
	{/if}
	<div class="flex items-baseline justify-between gap-3 text-xs text-stone-700">
		<span id="upload-progress-label" class="min-w-0 truncate font-semibold">{fileName}</span>
		<span data-testid="upload-percent" aria-hidden="true">{percent}%</span>
	</div>
	<div
		role="progressbar"
		aria-labelledby="upload-progress-label"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={percent}
		aria-valuetext={phase === 'finishing' ? 'Adding the file' : `${percent}%, ${sizes}`}
		class="h-2 overflow-hidden rounded-full bg-stone-200"
	>
		<div
			class="h-full bg-emerald-800 transition-[width] motion-reduce:transition-none"
			class:bg-red-700={phase === 'failed'}
			style:width="{percent}%"
		></div>
	</div>
	<div class="flex items-center justify-between gap-3 text-xs text-stone-600">
		<span data-testid="upload-bytes">
			{phase === 'finishing' ? 'Adding the file…' : sizes}
		</span>
		{#if phase === 'uploading'}
			<button
				type="button"
				onclick={oncancel}
				class="rounded-lg px-2 py-1 font-medium text-stone-700 focus-ring hover:bg-stone-200/70 coarse:min-h-11"
			>
				Cancel upload
			</button>
		{:else if phase === 'failed'}
			<button
				type="button"
				bind:this={retryButton}
				onclick={onretry}
				class="btn-primary-sm coarse:min-h-11"
			>
				Try again
			</button>
		{/if}
	</div>
</div>
