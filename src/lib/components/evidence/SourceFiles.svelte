<script lang="ts">
	import { FileText, FileX, Link2, Unlink, Upload } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import UploadProgress from '#lib/components/forms/UploadProgress.svelte';
	import {
		linkFileApi,
		unlinkFileApi,
		fetchFiles,
		mediaFromUploadApi,
		reorderFilesApi,
		updateFileLinkTitleApi
	} from '#lib/api/files.js';
	import { isAbortError, startUpload } from '#lib/api/uploader.js';
	import type { UploadCompleteDto } from '#lib/shared/uploads.js';
	import LinkControls from '#lib/components/media/LinkControls.svelte';
	import MediaFileList from '#lib/components/media/MediaFileList.svelte';
	import NotStoredBadge from '#lib/components/media/NotStoredBadge.svelte';
	import type { ExtraFileDto, FileRowDto } from '#lib/shared/files.js';
	import {
		extraFilesLabel,
		formatMediaSize,
		isInlineMediaType,
		mediaUrl,
		MEDIA_UPLOAD_ACCEPT,
		unresolvedFileLabel,
		type ObjectFileView
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

	let fileInput: HTMLInputElement | null = $state(null);
	/** The file on its way: its bytes so far, where it is, and the finished session once it is stored. */
	let sending = $state<{
		file: File;
		uploadedBytes: number;
		phase: 'uploading' | 'finishing' | 'failed';
		error: string | null;
		uploaded: UploadCompleteDto | null;
	} | null>(null);
	let uploadAbort: AbortController | null = null;
	const isBusy = $derived(sending !== null && sending.phase !== 'failed');

	/** Files in the tree with no owner, loaded when the picker opens; null while it is closed. */
	let detached = $state<FileRowDto[] | null>(null);
	let isLoadingDetached = $state(false);
	let pickerError = $state<string | null>(null);

	/** The title this source gives the file, else the file's own; an unresolved file falls back to its path. */
	const nameOf = (file: FileRowDto) =>
		file.hostLink?.title ??
		(file.isUnresolved ? unresolvedFileLabel(file) : (file.title ?? 'Untitled file'));

	/** The source's own order: the pointer's `sort_order` (null read as 0), then the listing's order. */
	const ordered = $derived(
		files
			.map((file, index) => ({ file, index }))
			.sort(
				(a, b) =>
					(a.file.hostLink?.sortOrder ?? 0) - (b.file.hostLink?.sortOrder ?? 0) || a.index - b.index
			)
			.map(({ file }) => file)
	);

	const viewOf = (file: {
		id: string;
		title: string | null;
		version: number;
		mimeType: string;
		sizeBytes: number | null;
		isUnresolved: boolean;
		gedcomPath: string | null;
		previewKey: string | null;
	}): ObjectFileView => file;
	const allFilesOf = (file: FileRowDto): ObjectFileView[] => [
		viewOf(file),
		...file.extraFiles.map((extra: ExtraFileDto) => viewOf(extra))
	];

	function move(file: FileRowDto, direction: 'up' | 'down') {
		const from = ordered.indexOf(file);
		const to = direction === 'up' ? from - 1 : from + 1;
		if (from < 0 || to < 0 || to >= ordered.length) return;
		const order = ordered.map((other) => other.objectId);
		[order[from], order[to]] = [order[to]!, order[from]!];
		void editor.mutate(
			() => reorderFilesApi({ treeId, entityId: sourceId, factId: null, orderedMediaIds: order }),
			{ done: 'Files reordered', failure: 'Could not reorder the files' }
		);
	}

	function saveTitle(file: FileRowDto, title: string): Promise<boolean> {
		return editor.mutate(
			() =>
				updateFileLinkTitleApi({
					fileId: file.objectId,
					treeId,
					entityId: sourceId,
					factId: null,
					title,
					version: file.objectVersion
				}),
			{ done: 'Title saved', failure: 'Could not save the title' }
		);
	}

	/**
	 * Sends the file in parts, then files it on the source. A failure stays in the progress panel
	 * with its own retry, which files the finished session rather than sending the bytes again.
	 */
	async function send(file: File, uploaded: UploadCompleteDto | null) {
		const controller = new AbortController();
		uploadAbort = controller;
		const patch = (changes: Partial<NonNullable<typeof sending>>) => {
			if (sending) sending = { ...sending, ...changes };
		};
		let done = uploaded;
		sending = { file, uploadedBytes: 0, phase: 'uploading', error: null, uploaded };
		try {
			done ??= await startUpload({
				file,
				treeId,
				purpose: 'media',
				signal: controller.signal,
				onProgress: (p) => patch({ uploadedBytes: p.uploadedBytes })
			});
			patch({ phase: 'finishing', uploadedBytes: file.size, uploaded: done });
			await mediaFromUploadApi({ sessionId: done.sessionId, entityId: sourceId, title: file.name });
			sending = null;
			await editor.refresh();
		} catch (cause) {
			if (controller.signal.aborted || isAbortError(cause)) {
				sending = null;
				return;
			}
			patch({
				phase: 'failed',
				error: messageOf(cause, 'Could not upload the file'),
				uploaded: done
			});
		} finally {
			uploadAbort = null;
		}
	}

	function upload(event: Event) {
		const input = event.target as HTMLInputElement;
		const picked = input.files?.[0];
		// Cleared so picking the same file again still fires a change.
		input.value = '';
		if (picked) void send(picked, null);
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
		await editor.mutate(() => unlinkFileApi(file.objectId, treeId, sourceId, undefined), {
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
						disabled={isBusy}
						class="sr-only"
						data-testid="source-file-input"
					/>
				</label>
			</div>
		{/if}
	</div>

	{#if sending}
		<div class="mt-2">
			<UploadProgress
				fileName={sending.file.name}
				uploadedBytes={sending.uploadedBytes}
				totalBytes={sending.file.size}
				phase={sending.phase}
				error={sending.error}
				oncancel={() => uploadAbort?.abort()}
				onretry={() => sending && void send(sending.file, sending.uploaded)}
			/>
		</div>
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
			{#each ordered as file, position (file.id)}
				<li class="flex flex-col gap-1" data-testid="source-file">
					{#if file.isUnresolved}
						<!-- No link and no <img>: the path is text the file was written with, never an address to fetch. -->
						<div
							class="flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-stone-400 bg-stone-100 p-1"
							data-testid="missing-file-tile"
						>
							<FileX class="h-8 w-8 text-stone-500" aria-hidden="true" />
							<NotStoredBadge />
						</div>
					{:else}
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
					{/if}
					<span class="truncate text-xs font-medium text-stone-800" title={nameOf(file)}
						>{nameOf(file)}</span
					>
					{#if file.extraFiles.length > 0 || file.isUnresolved || file.gedcomPath}
						<details class="text-[11px] text-stone-700 print:hidden">
							<summary class="cursor-pointer font-medium"
								>{extraFilesLabel(file.extraFiles.length)}</summary
							>
							<div class="mt-1">
								<MediaFileList
									files={allFilesOf(file)}
									{treeId}
									canAdd={canManage}
									onresolved={() => editor.refresh()}
								/>
							</div>
						</details>
					{/if}
					{#if canManage && file.canLink}
						<LinkControls
							label={nameOf(file)}
							linkTitle={file.hostLink?.title ?? null}
							canMoveUp={position > 0}
							canMoveDown={position < ordered.length - 1}
							onsavetitle={(title) => saveTitle(file, title)}
							onmove={(direction) => move(file, direction)}
						/>
					{/if}
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
