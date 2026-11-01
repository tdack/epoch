<script lang="ts">
	import { FileText, FileX, Trash2, Upload } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { canChangeRecords, type TreeRole } from '#lib/shared/roles.js';
	import { fileDrop } from '#lib/components/forms/fileDrop.js';
	import UploadProgress from '#lib/components/forms/UploadProgress.svelte';
	import {
		deleteFileApi,
		mediaFromUploadApi,
		reorderFilesApi,
		unlinkFileApi,
		updateFileLinkTitleApi
	} from '#lib/api/files.js';
	import { isAbortError, startUpload } from '#lib/api/uploader.js';
	import type { UploadCompleteDto } from '#lib/shared/uploads.js';
	import LinkControls from '#lib/components/media/LinkControls.svelte';
	import MediaFileList from '#lib/components/media/MediaFileList.svelte';
	import NotStoredBadge from '#lib/components/media/NotStoredBadge.svelte';
	import {
		extraFilesLabel,
		isInlineMediaType,
		mediaUrl,
		MEDIA_UPLOAD_ACCEPT,
		unresolvedFileLabel,
		type ObjectFileView
	} from '#lib/shared/media.js';
	import type { MediaFileDto, PersonMediaDto, PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** Reloads what the screen shows once a file is stored. */
		editor: TreeEditor;
		/** The viewer's role; uploading needs `media:manage` (editor and up), so lower roles see no Upload. */
		role: TreeRole | undefined;
	}

	let { dto, treeId, editor, role }: Props = $props();

	const canUpload = $derived(canChangeRecords(role));
	let isDragOver = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	/** The file on its way: its bytes so far and where it is; null when nothing is in progress. */
	let sending = $state<{
		file: File;
		uploadedBytes: number;
		phase: 'uploading' | 'finishing' | 'failed';
		error: string | null;
	} | null>(null);
	/** Files not yet filed, the first being the one in `sending`; a failure keeps them for the retry. */
	let queue: File[] = [];
	/** The finished session for `queue[0]` when only filing it failed, so a retry does not send the bytes again. */
	let finished: UploadCompleteDto | null = null;
	let uploadAbort: AbortController | null = null;
	const { toasts } = getTreeContext();
	/** The pointer whose delete is waiting for its second click; one at a time, so one key is enough. */
	let confirmingKey = $state<string | null>(null);
	let isDeleting = $state(false);

	/** One photo can be on the person and on a fact, so the object alone does not name an entry. */
	const keyOf = (item: PersonMediaDto) => `${item.objectId}:${item.factId ?? ''}`;

	/** The name a pointer shows: its own title where it has one, else the file's. */
	const nameOf = (item: PersonMediaDto) =>
		item.linkTitle ??
		(item.isUnresolved
			? unresolvedFileLabel(item)
			: (item.title ?? item.r2ObjectKey ?? 'Untitled file'));

	function viewOf(file: MediaFileDto): ObjectFileView {
		return {
			id: file.id,
			title: file.title,
			version: file.version,
			mimeType: file.mimeType,
			sizeBytes: null,
			isUnresolved: file.isUnresolved,
			gedcomPath: file.gedcomPath,
			previewKey: file.r2ObjectKey
		};
	}

	/** A file on other records too, or under a fact, is only unlinked here; deleting it would take it from them all. */
	const isUnlinkOnly = (item: PersonMediaDto) => item.isShared || item.factId !== null;

	async function confirmDelete(item: PersonMediaDto) {
		if (isDeleting) return;
		isDeleting = true;
		try {
			if (isUnlinkOnly(item))
				await unlinkFileApi(item.objectId, treeId, dto.person.id, item.objectVersion, item.factId);
			else await deleteFileApi(item.id, treeId);
			confirmingKey = null;
			await editor.refresh();
		} catch (cause) {
			const fallback = isUnlinkOnly(item)
				? 'Could not remove the file'
				: 'Could not delete the file';
			toasts.push(messageOf(cause, fallback), { tone: 'error' });
		} finally {
			isDeleting = false;
		}
	}

	/** Moves a pointer within the pointers that share its host (the person, or the same fact). */
	function move(item: PersonMediaDto, direction: 'up' | 'down') {
		const group = dto.media.filter((other) => other.factId === item.factId);
		const from = group.indexOf(item);
		const to = direction === 'up' ? from - 1 : from + 1;
		if (from < 0 || to < 0 || to >= group.length) return;
		const order = group.map((other) => other.objectId);
		[order[from], order[to]] = [order[to]!, order[from]!];
		void editor.mutate(
			() =>
				reorderFilesApi({
					treeId,
					entityId: dto.person.id,
					factId: item.factId,
					orderedMediaIds: order
				}),
			{ done: 'Files reordered', failure: 'Could not reorder the files' }
		);
	}

	function saveTitle(item: PersonMediaDto, title: string): Promise<boolean> {
		return editor.mutate(
			() =>
				updateFileLinkTitleApi({
					fileId: item.objectId,
					treeId,
					entityId: dto.person.id,
					factId: item.factId,
					title,
					version: item.objectVersion
				}),
			{ done: 'Title saved', failure: 'Could not save the title' }
		);
	}

	/** Queues the files; a run already in progress picks them up, so drops during an upload are not lost. */
	function upload(files: File[]) {
		queue.push(...files);
		if (sending === null) void sendQueue();
	}

	/** Sends the queue one file at a time; a failure stops there and waits for the retry. */
	async function sendQueue() {
		const controller = new AbortController();
		uploadAbort = controller;
		const patch = (changes: Partial<NonNullable<typeof sending>>) => {
			if (sending) sending = { ...sending, ...changes };
		};
		try {
			while (queue.length > 0) {
				const file = queue[0]!;
				sending = { file, uploadedBytes: 0, phase: 'uploading', error: null };
				try {
					finished ??= await startUpload({
						file,
						treeId,
						purpose: 'media',
						signal: controller.signal,
						onProgress: (p) => patch({ uploadedBytes: p.uploadedBytes })
					});
					patch({ phase: 'finishing', uploadedBytes: file.size });
					await mediaFromUploadApi({
						sessionId: finished.sessionId,
						entityId: dto.person.id,
						title: file.name
					});
					finished = null;
					queue.shift();
				} catch (cause) {
					if (controller.signal.aborted || isAbortError(cause)) {
						queue = [];
						finished = null;
						sending = null;
						return;
					}
					patch({ phase: 'failed', error: messageOf(cause, 'Could not upload the file') });
					return;
				}
			}
			sending = null;
		} finally {
			uploadAbort = null;
			await editor.refresh();
		}
	}

	function handleFileUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const chosen = [...(input.files ?? [])];
		// Cleared so picking the same file again still fires a change.
		input.value = '';
		if (chosen.length > 0) upload(chosen);
	}
</script>

<!-- The whole section takes a dropped file; the Upload input stays the keyboard path. -->
<div
	class="space-y-2 rounded-lg outline-2 -outline-offset-2 {isDragOver
		? 'bg-emerald-50 outline-emerald-700 outline-dashed'
		: 'outline-transparent'}"
	data-testid="person-media-drop"
	use:fileDrop={{
		isEnabled: canUpload,
		onActiveChange: (isActive) => (isDragOver = isActive),
		onFiles: (files) => upload(files)
	}}
>
	<!-- With nothing attached, the empty line and Upload share one row. -->
	<div class="flex items-baseline justify-between gap-3">
		{#if dto.media.length === 0}
			<p class="text-xs text-stone-500 italic print:hidden">
				No photos or historical documents attached.
			</p>
		{/if}
		{#if canUpload}
			<label
				class="ml-auto inline-flex shrink-0 cursor-pointer items-center text-xs font-semibold text-emerald-800 hover:text-emerald-700 print:hidden"
			>
				<Upload class="mr-1 h-3.5 w-3.5" />
				<span>Upload</span>
				<input
					bind:this={fileInput}
					type="file"
					accept={MEDIA_UPLOAD_ACCEPT}
					multiple
					onchange={handleFileUpload}
					class="hidden"
				/>
			</label>
		{/if}
	</div>

	{#if isDragOver}
		<p class="text-xs font-medium text-emerald-800">Drop to upload</p>
	{/if}
	{#if sending}
		<UploadProgress
			fileName={sending.file.name}
			uploadedBytes={sending.uploadedBytes}
			totalBytes={sending.file.size}
			phase={sending.phase}
			error={sending.error}
			oncancel={() => uploadAbort?.abort()}
			onretry={() => void sendQueue()}
		/>
	{/if}

	{#if dto.media.length > 0}
		<ul class="grid grid-cols-2 gap-2 print:grid-cols-4" aria-label="Attached files">
			{#each dto.media as item (keyOf(item))}
				{@const group = dto.media.filter((other) => other.factId === item.factId)}
				{@const position = group.indexOf(item)}
				<li class="flex flex-col gap-1" data-testid="person-media-item">
					{#if item.isUnresolved}
						<!-- No link and no <img>: the path is text the file was written with, never an address to fetch. -->
						<div
							class="flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border border-dashed border-stone-400 bg-stone-100 p-1"
							data-testid="missing-file-tile"
						>
							<FileX class="h-8 w-8 text-stone-500" aria-hidden="true" />
							<span class="w-full truncate px-1 text-center text-[10px] font-medium text-stone-700"
								>{nameOf(item)}</span
							>
							<NotStoredBadge />
						</div>
					{:else}
						<a
							href={item.r2ObjectKey ? mediaUrl(item.r2ObjectKey) : undefined}
							target="_blank"
							rel="noreferrer"
							class="group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 transition-colors hover:border-emerald-600"
						>
							{#if item.r2ObjectKey && isInlineMediaType(item.mimeType)}
								<img
									src={mediaUrl(item.r2ObjectKey)}
									alt={nameOf(item)}
									class="h-full w-full object-cover transition-transform group-hover:scale-105"
									loading="eager"
								/>
							{:else}
								<FileText class="h-8 w-8 text-stone-500" />
								<span
									class="mt-1 w-full truncate px-1 text-center text-[10px] font-medium text-stone-700"
									>{nameOf(item)}</span
								>
							{/if}
							<span class="sr-only">(opens in a new tab)</span>
						</a>
					{/if}
					<!-- On paper the tile may print blank (a file that is not an image, or no network), so the name stays. -->
					{#if item.isUnresolved || isInlineMediaType(item.mimeType)}
						<span class="text-[10px] break-words {item.isUnresolved ? '' : 'hidden print:block'}"
							>{nameOf(item)}</span
						>
					{/if}
					{#if item.factLabel}
						<span
							class="self-start rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-700"
							data-testid="media-fact-label">{item.factLabel}</span
						>
					{/if}
					{#if item.extraFiles.length > 0 || item.isUnresolved || item.gedcomPath}
						<details class="text-[11px] text-stone-700 print:hidden">
							<summary class="cursor-pointer font-medium">
								{extraFilesLabel(item.extraFiles.length)}
							</summary>
							<div class="mt-1">
								<MediaFileList
									files={[viewOf(item), ...item.extraFiles.map(viewOf)]}
									{treeId}
									canAdd={canUpload}
									onresolved={() => editor.refresh()}
								/>
							</div>
						</details>
					{/if}
					{#if canUpload && item.canUnlink}
						<LinkControls
							label={nameOf(item)}
							linkTitle={item.linkTitle}
							canMoveUp={position > 0}
							canMoveDown={position < group.length - 1}
							onsavetitle={(title) => saveTitle(item, title)}
							onmove={(direction) => move(item, direction)}
						/>
					{/if}
					{#if isUnlinkOnly(item) ? item.canUnlink : item.canDelete}
						{#if confirmingKey === keyOf(item)}
							<div
								class="space-y-1.5 rounded-lg border border-red-300 bg-red-50 p-2 text-[11px] text-red-900"
							>
								<p>
									{item.factId
										? 'Remove this file from this fact? It stays on the person and anything else it is linked to.'
										: item.isShared
											? 'Remove this file from this person? It stays on the other records it is linked to.'
											: 'Delete this file for good? It is removed from storage and cannot be undone.'}
								</p>
								<div class="flex flex-wrap gap-1.5">
									<button
										type="button"
										disabled={isDeleting}
										onclick={() => confirmDelete(item)}
										class="rounded-md bg-red-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
										>{isUnlinkOnly(item) ? 'Confirm remove' : 'Confirm delete'}</button
									>
									<button
										type="button"
										disabled={isDeleting}
										onclick={() => (confirmingKey = null)}
										class="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-semibold text-stone-700 disabled:opacity-50"
										>Cancel</button
									>
								</div>
							</div>
						{:else}
							<button
								type="button"
								onclick={() => (confirmingKey = keyOf(item))}
								class="inline-flex items-center justify-center gap-1 self-end rounded-md px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
							>
								<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
								<span
									>{isUnlinkOnly(item) ? 'Remove' : 'Delete'}<span class="sr-only">
										{item.title ?? 'file'}</span
									></span
								>
							</button>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
