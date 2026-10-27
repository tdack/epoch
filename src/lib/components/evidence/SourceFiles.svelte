<script lang="ts">
	import { FileText, Link2, Unlink, Upload } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { linkFileApi, unlinkFileApi, fetchFiles, uploadMediaApi } from '#lib/api/files.js';
	import type { FileRowDto } from '#lib/shared/files.js';
	import {
		formatMediaSize,
		isInlineMediaType,
		mediaUrl,
		MEDIA_UPLOAD_ACCEPT
	} from '#lib/shared/media.js';

	interface Props {
		treeId: string;
		sourceId: string;
		/** Files attached to this source that the viewer may see. */
		files: FileRowDto[];
		/** Whether the viewer's role may add and detach files; every write is checked again by the server. */
		canManage: boolean;
		/** Reloads the screen once a file is stored, attached or detached. */
		editor: TreeEditor;
	}

	let { treeId, sourceId, files, canManage, editor }: Props = $props();

	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);

	/** Files in the tree with no owner, loaded when the picker opens; null while it is closed. */
	let detached = $state<FileRowDto[] | null>(null);
	let isLoadingDetached = $state(false);
	let pickerError = $state<string | null>(null);

	const nameOf = (file: FileRowDto) => file.title ?? 'Untitled file';

	async function upload(event: Event) {
		const input = event.target as HTMLInputElement;
		const picked = input.files?.[0];
		if (!picked) return;
		isUploading = true;
		uploadError = null;
		try {
			await uploadMediaApi(treeId, sourceId, picked);
			await editor.refresh();
		} catch (cause) {
			uploadError = messageOf(cause, 'Could not upload the file');
		} finally {
			isUploading = false;
			if (fileInput) fileInput.value = '';
		}
	}

	async function openPicker() {
		isLoadingDetached = true;
		pickerError = null;
		try {
			const page = await fetchFiles({ treeId, isDetachedOnly: true, limit: 100 });
			detached = page.files.filter((file) => file.canLink);
		} catch (cause) {
			pickerError = messageOf(cause, 'Could not list the unattached files');
			detached = [];
		} finally {
			isLoadingDetached = false;
		}
	}

	async function attach(file: FileRowDto) {
		const isDone = await editor.mutate(() => linkFileApi(file.id, treeId, sourceId, undefined), {
			done: 'File attached to the source',
			failure: 'Could not attach the file'
		});
		if (isDone) detached = null;
	}

	async function detach(file: FileRowDto) {
		await editor.mutate(() => unlinkFileApi(file.id, treeId, sourceId, undefined), {
			done: 'File detached from the source',
			failure: 'Could not detach the file'
		});
	}
</script>

<section
	aria-labelledby="source-files-heading"
	class={['section-card', files.length === 0 && 'print:hidden']}
	data-testid="source-files"
>
	<div class="flex items-center justify-between gap-3">
		<h3 id="source-files-heading" class="section-heading">
			Files
			<span class="font-normal text-stone-500">· {files.length}</span>
		</h3>
		{#if canManage}
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="action-btn"
					disabled={isLoadingDetached}
					onclick={() => (detached === null ? void openPicker() : (detached = null))}
					aria-expanded={detached !== null}
					><Link2 class="h-3.5 w-3.5" aria-hidden="true" />Attach existing</button
				>
				<label
					class="action-btn focus-within:outline-2 focus-within:outline-emerald-700 print:hidden"
				>
					<Upload class="h-3.5 w-3.5" aria-hidden="true" />
					<span>Upload</span>
					<input
						bind:this={fileInput}
						type="file"
						accept={MEDIA_UPLOAD_ACCEPT}
						onchange={upload}
						class="sr-only"
						data-testid="source-file-input"
					/>
				</label>
			</div>
		{/if}
	</div>

	{#if isUploading}
		<p class="mt-2 animate-pulse text-xs font-medium text-emerald-800" role="status">Uploading…</p>
	{/if}
	{#if uploadError}
		<p class="mt-2 text-xs font-medium text-red-700" role="alert">{uploadError}</p>
	{/if}

	{#if detached !== null}
		<div class="mt-3 rounded-xl border border-stone-200 bg-white p-3" data-testid="attach-picker">
			<p class="text-xs font-semibold text-stone-700">Files not attached to anything</p>
			{#if pickerError}
				<p class="mt-1 text-xs font-medium text-red-700" role="alert">{pickerError}</p>
			{:else if detached.length === 0}
				<p class="mt-1 text-xs text-stone-500 italic">
					Every file in this tree is already attached. Upload a new one instead.
				</p>
			{:else}
				<ul class="mt-1 divide-y divide-stone-100">
					{#each detached as file (file.id)}
						<li class="flex items-center justify-between gap-3 py-1.5 text-sm">
							<span class="min-w-0 truncate">
								{nameOf(file)}
								<span class="text-xs text-stone-500">· {formatMediaSize(file.sizeBytes)}</span>
							</span>
							<button
								type="button"
								class="action-btn shrink-0"
								onclick={() => void attach(file)}
								aria-label={`Attach ${nameOf(file)} to this source`}>Attach</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if files.length === 0}
		<p class="mt-2 text-xs text-stone-500 italic print:hidden" data-testid="no-source-files">
			{canManage
				? 'No file is attached. Upload a scan or photo of the source, or attach one from the tree.'
				: 'No file is attached to this source.'}
		</p>
	{:else}
		<ul
			class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-4"
			aria-label="Attached files"
		>
			{#each files as file (file.id)}
				<li class="flex flex-col gap-1" data-testid="source-file">
					<a
						href={file.previewKey ? mediaUrl(file.previewKey) : undefined}
						target="_blank"
						rel="noreferrer"
						class="group flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 hover:border-emerald-600"
					>
						{#if file.previewKey && isInlineMediaType(file.mimeType)}
							<img
								src={mediaUrl(file.previewKey)}
								alt={nameOf(file)}
								class="h-full w-full object-cover"
							/>
						{:else}
							<FileText class="h-8 w-8 text-stone-500" aria-hidden="true" />
						{/if}
						<span class="sr-only">{nameOf(file)} (opens in a new tab)</span>
					</a>
					<span class="truncate text-xs font-medium text-stone-800" title={nameOf(file)}
						>{nameOf(file)}</span
					>
					{#if file.canLink}
						<button
							type="button"
							class="row-link inline-flex items-center gap-1 self-start text-xs"
							onclick={() => void detach(file)}
							><Unlink class="h-3 w-3" aria-hidden="true" />Detach<span class="sr-only">
								{nameOf(file)}</span
							></button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
