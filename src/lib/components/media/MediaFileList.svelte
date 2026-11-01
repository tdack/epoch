<script lang="ts">
	import { FilePlus, FileText, FileX } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { resolveFileFromUploadApi } from '#lib/api/files.js';
	import { isAbortError, startUpload } from '#lib/api/uploader.js';
	import {
		formatMediaSize,
		isWebUrl,
		MEDIA_UPLOAD_ACCEPT,
		mediaUrl,
		unresolvedFileLabel
	} from '#lib/shared/media.js';
	import type { ObjectFileView } from '#lib/shared/media.js';
	import NotStoredBadge from './NotStoredBadge.svelte';

	interface Props {
		/** Every file of the object, in order. */
		files: ObjectFileView[];
		treeId: string;
		/** Offer "Add file…" on an unresolved file; the server checks `media:manage` again. */
		canAdd: boolean;
		/** Called once a file has been given its bytes, so the screen can reload. */
		onresolved: () => void | Promise<void>;
	}

	let { files, treeId, canAdd, onresolved }: Props = $props();

	/** The file being filled, so one upload runs at a time per list. */
	let busyId = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function addFile(file: ObjectFileView, picked: File) {
		if (busyId) return;
		busyId = file.id;
		error = null;
		try {
			const { sessionId } = await startUpload({ file: picked, treeId, purpose: 'media' });
			await resolveFileFromUploadApi({ fileId: file.id, sessionId, version: file.version });
			await onresolved();
		} catch (cause) {
			if (!isAbortError(cause)) error = messageOf(cause, 'Could not add the file');
		} finally {
			busyId = null;
		}
	}
</script>

<ul class="space-y-2 text-xs text-stone-700" aria-label="Files">
	{#each files as file (file.id)}
		<li
			class="flex flex-col gap-1 rounded-lg border border-stone-200 bg-white p-2"
			data-testid="object-file"
		>
			<div class="flex items-center gap-2">
				{#if file.isUnresolved}
					<FileX class="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
					<span class="min-w-0 font-semibold break-words text-stone-900"
						>{unresolvedFileLabel(file)}</span
					>
					<NotStoredBadge />
				{:else}
					<FileText class="h-4 w-4 shrink-0 text-stone-500" aria-hidden="true" />
					<span class="min-w-0 font-semibold break-words text-stone-900"
						>{file.title ?? 'Untitled file'}</span
					>
					<span class="text-stone-500"
						>{file.mimeType}{file.sizeBytes === null
							? ''
							: ` · ${formatMediaSize(file.sizeBytes)}`}</span
					>
				{/if}
			</div>
			{#if file.gedcomPath}
				<p class="break-all" data-testid="file-path">
					<span class="text-stone-500">Written as </span>
					{#if isWebUrl(file.gedcomPath)}
						<a
							href={file.gedcomPath}
							target="_blank"
							rel="noopener noreferrer"
							class="font-medium text-emerald-800 underline"
							>{file.gedcomPath}<span class="sr-only"> (opens in a new tab)</span></a
						>
					{:else}
						<span class="font-mono">{file.gedcomPath}</span>
					{/if}
				</p>
			{/if}
			{#if file.previewKey}
				<a
					href={mediaUrl(file.previewKey)}
					target="_blank"
					rel="noopener noreferrer"
					class="self-start font-semibold text-emerald-800 underline"
					>Open<span class="sr-only"> {file.title ?? 'file'} (opens in a new tab)</span></a
				>
			{/if}
			{#if file.isUnresolved && canAdd}
				<label
					class="action-btn cursor-pointer self-start focus-within:outline-2 focus-within:outline-emerald-700 {busyId ===
					file.id
						? 'opacity-50'
						: ''}"
				>
					<FilePlus class="h-3.5 w-3.5" aria-hidden="true" />
					<span>{busyId === file.id ? 'Adding…' : 'Add file…'}</span>
					<span class="sr-only"> for {unresolvedFileLabel(file)}</span>
					<input
						type="file"
						accept={MEDIA_UPLOAD_ACCEPT}
						disabled={busyId !== null}
						class="sr-only"
						data-testid="add-file-input"
						onchange={(event) => {
							const input = event.currentTarget as HTMLInputElement;
							const picked = input.files?.[0];
							input.value = '';
							if (picked) void addFile(file, picked);
						}}
					/>
				</label>
			{/if}
		</li>
	{/each}
</ul>
{#if error}
	<p class="mt-1 text-xs font-medium text-red-700" role="alert">{error}</p>
{/if}
