<script lang="ts">
	import { FileText, Image as ImageIcon, Trash2, Upload } from '@lucide/svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { deleteFileApi, uploadMediaApi } from '#lib/services/tree-api.js';
	import { isInlineMediaType, mediaUrl, MEDIA_UPLOAD_ACCEPT } from '#lib/shared/media.js';
	import type { PersonPageDto } from '#lib/shared/person-page.js';

	interface Props {
		dto: PersonPageDto;
		treeId: string;
		/** Reloads what the screen shows once a file is stored. */
		editor: TreeEditor;
	}

	let { dto, treeId, editor }: Props = $props();

	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);
	const { toasts } = getTreeContext();
	/** The file whose delete is waiting for its second click; one at a time, so one id is enough. */
	let confirmingId = $state<string | null>(null);
	let isDeleting = $state(false);

	async function confirmDelete(fileId: string) {
		if (isDeleting) return;
		isDeleting = true;
		try {
			await deleteFileApi(fileId, treeId);
			confirmingId = null;
			await editor.refresh();
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not delete the file', { tone: 'error' });
		} finally {
			isDeleting = false;
		}
	}

	async function handleFileUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files || target.files.length === 0) return;

		isUploading = true;
		uploadError = null;
		try {
			await uploadMediaApi(treeId, dto.person.id, target.files[0]!);
			await editor.refresh();
		} catch (cause) {
			uploadError = (cause as Error).message;
		} finally {
			isUploading = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<div class="flex justify-end">
	<label
		class="inline-flex cursor-pointer items-center text-xs font-semibold text-emerald-800 hover:text-emerald-700"
	>
		<Upload class="mr-1 h-3.5 w-3.5" />
		<span>Upload</span>
		<input
			bind:this={fileInput}
			type="file"
			accept={MEDIA_UPLOAD_ACCEPT}
			onchange={handleFileUpload}
			class="hidden"
		/>
	</label>
</div>

{#if isUploading}
	<p class="animate-pulse text-xs font-medium text-emerald-800">Uploading...</p>
{/if}
{#if uploadError}
	<p class="text-xs font-medium text-orange-700">{uploadError}</p>
{/if}

{#if dto.media.length === 0}
	<div
		class="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 p-4 text-center text-xs text-stone-500"
	>
		<ImageIcon class="mx-auto mb-1 h-6 w-6 text-stone-400" />
		No photos or historical documents attached
	</div>
{:else}
	<ul class="grid grid-cols-2 gap-2" aria-label="Attached files">
		{#each dto.media as item (item.id)}
			<li class="flex flex-col gap-1">
				<a
					href={mediaUrl(item.r2ObjectKey)}
					target="_blank"
					rel="noreferrer"
					class="group relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border border-stone-300 bg-stone-100 transition-colors hover:border-emerald-600"
				>
					{#if isInlineMediaType(item.mimeType)}
						<img
							src={mediaUrl(item.r2ObjectKey)}
							alt={item.title || 'Media'}
							class="h-full w-full object-cover transition-transform group-hover:scale-105"
						/>
					{:else}
						<FileText class="h-8 w-8 text-stone-500" />
						<span
							class="mt-1 w-full truncate px-1 text-center text-[10px] font-medium text-stone-700"
							>{item.title ?? item.r2ObjectKey}</span
						>
					{/if}
				</a>
				{#if item.canDelete}
					{#if confirmingId === item.id}
						<div
							class="space-y-1.5 rounded-lg border border-red-300 bg-red-50 p-2 text-[11px] text-red-900"
						>
							<p>Delete this file for good? It is removed from storage and cannot be undone.</p>
							<div class="flex flex-wrap gap-1.5">
								<button
									type="button"
									disabled={isDeleting}
									onclick={() => confirmDelete(item.id)}
									class="rounded-md bg-red-700 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
									>Confirm delete</button
								>
								<button
									type="button"
									disabled={isDeleting}
									onclick={() => (confirmingId = null)}
									class="rounded-md border border-stone-300 px-2 py-1 text-[11px] font-semibold text-stone-700 disabled:opacity-50"
									>Cancel</button
								>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (confirmingId = item.id)}
							class="inline-flex items-center justify-center gap-1 self-end rounded-md px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
						>
							<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
							<span>Delete<span class="sr-only"> {item.title ?? 'file'}</span></span>
						</button>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
