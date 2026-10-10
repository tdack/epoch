<script lang="ts">
	import { FileText, Image as ImageIcon, Upload } from '@lucide/svelte';
	import type { TreeEditor } from '#lib/components/tree/tree-editor.svelte.js';
	import { uploadMediaApi } from '#lib/services/tree-api.js';
	import { isInlineMediaType, MEDIA_UPLOAD_ACCEPT } from '#lib/shared/media.js';
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

	/**
	 * Older media responses were cached as immutable for a year, so a browser keeps them until the
	 * URL changes. The version query is what evicts them after the serve path changed; bump it when
	 * the bytes a URL returns can change again.
	 */
	const MEDIA_URL_VERSION = 2;
	function mediaUrl(objectKey: string): string {
		return `/api/media/${objectKey}?v=${MEDIA_URL_VERSION}`;
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
	<div class="grid grid-cols-2 gap-2">
		{#each dto.media as item (item.id)}
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
					<span class="mt-1 w-full truncate px-1 text-center text-[10px] font-medium text-stone-700"
						>{item.title ?? item.r2ObjectKey}</span
					>
				{/if}
			</a>
		{/each}
	</div>
{/if}
