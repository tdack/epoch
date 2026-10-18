<script lang="ts">
	import { untrack } from 'svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import {
		ArrowRightLeft,
		Download,
		Eye,
		FileText,
		Image as ImageIcon,
		Link,
		Pencil,
		Plus,
		Search,
		Trash2,
		Unlink,
		Upload,
		X
	} from '@lucide/svelte';
	import BaseModal from '#lib/components/modals/BaseModal.svelte';
	import PersonPicker from '#lib/components/PersonPicker.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import {
		attachFileApi,
		deleteFileApi,
		deleteUnlinkedFilesApi,
		detachFileApi,
		fetchFiles,
		fetchFileUsage,
		fetchUnlinkedFiles,
		moveFileApi,
		renameFileApi,
		uploadMediaApi
	} from '#lib/api/files.js';
	import type { FileRowDto, FileUsageDto, UnlinkedListDto } from '#lib/shared/files.js';
	import {
		formatMediaSize,
		isInlineMediaType,
		MEDIA_UPLOAD_ACCEPT,
		mediaUrl
	} from '#lib/shared/media.js';
	import { canChangeRecords, isManagerOrAbove } from '#lib/shared/roles.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { toasts } = getTreeContext();
	const treeId = $derived(data.summary.tree.id);
	const role = $derived(data.trees.find((t) => t.id === treeId)?.role);
	/** Uploads, renames and moves are offered to editors and up; the server checks each one again. */
	const canEdit = $derived(canChangeRecords(role));
	/** Clearing stored files with no record is a manager's job. */
	const canManage = $derived(isManagerOrAbove(role));

	/** The filter's value for every tree the caller belongs to. */
	const ALL_TREES = 'all';
	let filter = $state<string>(untrack(() => treeId));
	let files = $state<FileRowDto[]>(untrack(() => data.files.files));
	let nextCursor = $state<string | null>(untrack(() => data.files.nextCursor));
	let usage = $state<FileUsageDto>(untrack(() => data.usage));
	let isLoading = $state(false);
	let listError = $state<string | null>(null);
	/** Bumped on every new listing, so an answer to an earlier filter cannot overwrite the current one. */
	let listing = 0;

	let unlinked = $state<UnlinkedListDto | null>(null);
	let isCheckingUnlinked = $state(false);

	type Dialog = 'upload' | 'rename' | 'attach' | 'move' | 'delete' | 'preview' | 'unlinked' | null;
	let dialog = $state<Dialog>(null);
	let target = $state<FileRowDto | null>(null);
	let isBusy = $state(false);
	let dialogError = $state<string | null>(null);
	let renameTitle = $state('');
	let uploadFile = $state<File | null>(null);
	let chosenPerson = $state<{ id: string; name: string } | null>(null);

	const actionClass =
		'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-700 focus-ring hover:bg-stone-200/70 coarse:min-h-11';
	const scopeOf = (value: string) => (value === ALL_TREES ? null : value);
	const hasUploader = $derived(files.some((file) => file.uploadedBy !== null));
	const thisTreeUsage = $derived(usage.trees.find((t) => t.treeId === treeId) ?? null);
	const totalStored = $derived(usage.trees.reduce((sum, t) => sum + t.storedBytes, 0));

	const formatDate = (ms: number | null) =>
		ms === null
			? '—'
			: new Date(ms).toLocaleDateString(undefined, {
					day: 'numeric',
					month: 'short',
					year: 'numeric'
				});

	/**
	 * Lists files for the filter, from the start. A page can be short or empty for a restricted viewer
	 * while more follow, so an empty page keeps the listing going until it finds one or runs out.
	 */
	async function listFrom(value: string) {
		const mine = ++listing;
		isLoading = true;
		listError = null;
		try {
			let cursor: string | null = null;
			let page;
			let found: FileRowDto[] = [];
			do {
				page = await fetchFiles({ treeId: scopeOf(value), cursor });
				found = [...found, ...page.files];
				cursor = page.nextCursor;
			} while (page.files.length === 0 && cursor !== null);
			if (mine !== listing) return;
			files = found;
			nextCursor = cursor;
		} catch (cause) {
			if (mine === listing) listError = messageOf(cause, 'Could not load files');
		} finally {
			if (mine === listing) isLoading = false;
		}
	}

	async function loadMore() {
		if (!nextCursor || isLoading) return;
		const mine = ++listing;
		isLoading = true;
		listError = null;
		try {
			let cursor: string | null = nextCursor;
			let page;
			let found: FileRowDto[] = [];
			do {
				page = await fetchFiles({ treeId: scopeOf(filter), cursor });
				found = [...found, ...page.files];
				cursor = page.nextCursor;
			} while (page.files.length === 0 && cursor !== null);
			if (mine !== listing) return;
			files = [...files, ...found];
			nextCursor = cursor;
		} catch (cause) {
			if (mine === listing) listError = messageOf(cause, 'Could not load more files');
		} finally {
			if (mine === listing) isLoading = false;
		}
	}

	async function refreshUsage() {
		usage = await fetchFileUsage(null).catch(() => usage);
	}

	/** Reloads the list as it stands, and the storage figures, after a change. */
	async function reload() {
		await Promise.all([listFrom(filter), refreshUsage()]);
	}

	function changeFilter(value: string) {
		filter = value;
		unlinked = null;
		void listFrom(value);
	}

	function openDialog(kind: Exclude<Dialog, null>, file: FileRowDto | null = null) {
		target = file;
		dialog = kind;
		dialogError = null;
		isBusy = false;
		chosenPerson = null;
		if (kind === 'rename') renameTitle = file?.title ?? '';
		if (kind === 'upload') uploadFile = null;
	}

	function closeDialog() {
		dialog = null;
	}

	/** Runs one change: a failure stays in the dialog, a success closes it and reloads. */
	async function run(work: () => Promise<unknown>, done: string) {
		if (isBusy) return;
		isBusy = true;
		dialogError = null;
		try {
			await work();
			dialog = null;
			toasts.push(done);
			await reload();
		} catch (cause) {
			dialogError = messageOf(cause, 'That did not work');
		} finally {
			isBusy = false;
		}
	}

	const uploadTo = () => {
		const file = uploadFile;
		const person = chosenPerson;
		if (!file || !person) return;
		return run(() => uploadMediaApi(treeId, person.id, file), `Uploaded ${file.name}`);
	};

	function rename(event: SubmitEvent) {
		event.preventDefault();
		const file = target!;
		void run(
			() => renameFileApi(file.id, file.treeId, renameTitle.trim(), undefined),
			'File renamed'
		);
	}

	const attachTo = () => {
		const file = target!;
		const person = chosenPerson;
		if (!person) return;
		void run(() => attachFileApi(file.id, file.treeId, person.id, undefined), 'File attached');
	};

	const moveTo = () => {
		const file = target!;
		const person = chosenPerson;
		if (!person) return;
		void run(() => moveFileApi(file.id, file.treeId, person.id, undefined), 'File moved');
	};

	const removeFile = () => {
		const file = target!;
		void run(() => deleteFileApi(file.id, file.treeId), 'File deleted');
	};

	async function detach(file: FileRowDto) {
		try {
			await detachFileApi(file.id, file.treeId, undefined);
			toasts.push('File detached');
			await reload();
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not detach the file'), { tone: 'error' });
		}
	}

	async function checkUnlinked() {
		isCheckingUnlinked = true;
		try {
			unlinked = await fetchUnlinkedFiles(scopeOf(filter));
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not list stored files'), { tone: 'error' });
		} finally {
			isCheckingUnlinked = false;
		}
	}

	function clearUnlinked() {
		void run(async () => {
			const result = await deleteUnlinkedFilesApi(scopeOf(filter));
			unlinked = null;
			if (result.failed > 0) throw new Error(`${result.failed} stored files could not be deleted`);
		}, 'Stored files with no record deleted');
	}
</script>

<svelte:head>
	<title>Files · {data.summary.tree.name} · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900">Files</h2>
		<p class="mt-1 max-w-2xl text-sm text-stone-600">
			Photos and documents stored in your trees. A file shows on the person it is attached to, and
			anyone who can see that person can see the file.
		</p>
	</div>
	{#if canEdit}
		<button
			type="button"
			data-testid="files-add"
			onclick={() => openDialog('upload')}
			class="btn-primary-sm gap-1.5"
		>
			<Plus class="h-3.5 w-3.5" aria-hidden="true" />
			Add a file
		</button>
	{/if}
</div>

<section
	class="mt-6 grid gap-3 rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-700 sm:grid-cols-2"
	aria-labelledby="usage-heading"
>
	<h3 id="usage-heading" class="sr-only">Storage</h3>
	{#if thisTreeUsage}
		<div>
			<p>
				<span class="font-semibold">{data.summary.tree.name}</span>: {formatMediaSize(
					thisTreeUsage.storedBytes
				)}
				of {formatMediaSize(thisTreeUsage.limitBytes)} used
			</p>
			<progress
				class="mt-1 h-2 w-full"
				max={thisTreeUsage.limitBytes}
				value={thisTreeUsage.storedBytes}
				aria-label="Storage used in {data.summary.tree.name}"
			></progress>
		</div>
	{/if}
	{#if usage.trees.length > 1}
		<p>Across the trees you can manage: {formatMediaSize(totalStored)}</p>
	{/if}
	{#if usage.installBytes !== null}
		<p data-testid="files-install-total">
			Whole install, every tree: {formatMediaSize(usage.installBytes)}
		</p>
	{/if}
</section>

<div class="mt-6 flex flex-wrap items-end gap-3">
	<div>
		<label for="files-tree" class="block text-xs font-semibold text-stone-700">Tree</label>
		<select
			id="files-tree"
			value={filter}
			onchange={(event) => changeFilter((event.currentTarget as HTMLSelectElement).value)}
			class="mt-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
		>
			<option value={ALL_TREES}>All my trees</option>
			{#each data.trees as tree (tree.id)}
				<option value={tree.id}>{tree.name}</option>
			{/each}
		</select>
	</div>
	<p class="pb-1.5 text-xs text-stone-600" role="status" aria-live="polite">
		{#if isLoading}Loading files…{:else}{files.length} shown{nextCursor
				? ', more to load'
				: ''}{/if}
	</p>
</div>

{#if listError}
	<p role="alert" class="mt-3 text-xs font-medium text-orange-700">{listError}</p>
{/if}

<div class="mt-4 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
	<table class="w-full min-w-[46rem] text-left text-xs">
		<caption class="sr-only">Files in the trees you belong to</caption>
		<thead class="border-b border-stone-200 bg-stone-50 text-stone-600">
			<tr>
				<th scope="col" class="w-12 px-3 py-2 font-semibold"
					><span class="sr-only">Preview</span></th
				>
				<th scope="col" class="px-3 py-2 font-semibold">Name</th>
				<th scope="col" class="px-3 py-2 font-semibold">Type</th>
				<th scope="col" class="px-3 py-2 text-right font-semibold">Size</th>
				<th scope="col" class="px-3 py-2 font-semibold">Attached to</th>
				{#if hasUploader}
					<th scope="col" class="px-3 py-2 font-semibold">Uploaded by</th>
				{/if}
				<th scope="col" class="px-3 py-2 font-semibold">Tree</th>
				<th scope="col" class="px-3 py-2 font-semibold">Date</th>
				<th scope="col" class="px-3 py-2 font-semibold"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-stone-100">
			{#each files as file (file.id)}
				<tr data-testid="file-row">
					<td class="px-3 py-2">
						{#if file.previewKey && isInlineMediaType(file.mimeType)}
							<img
								src={mediaUrl(file.previewKey)}
								alt=""
								loading="lazy"
								class="h-9 w-9 rounded object-cover"
							/>
						{:else if file.mimeType === 'application/pdf'}
							<FileText class="h-6 w-6 text-stone-500" aria-hidden="true" />
						{:else}
							<ImageIcon class="h-6 w-6 text-stone-400" aria-hidden="true" />
						{/if}
					</td>
					<th
						scope="row"
						class="max-w-xs px-3 py-2 text-left font-semibold break-words text-stone-900"
					>
						{file.title ?? 'Untitled'}
					</th>
					<td class="px-3 py-2 text-stone-600">{file.mimeType}</td>
					<td class="px-3 py-2 text-right text-stone-600 tabular-nums"
						>{formatMediaSize(file.sizeBytes)}</td
					>
					<td class="px-3 py-2 text-stone-600">{file.attachedTo ?? 'Not attached'}</td>
					{#if hasUploader}
						<td class="px-3 py-2 text-stone-600">{file.uploadedBy ?? '—'}</td>
					{/if}
					<td class="px-3 py-2 text-stone-600">{file.treeName}</td>
					<td class="px-3 py-2 whitespace-nowrap text-stone-600">{formatDate(file.createdAt)}</td>
					<td class="px-3 py-2">
						<div class="flex flex-wrap justify-end gap-1">
							{#if file.canPreview}
								<button
									type="button"
									class={actionClass}
									onclick={() => openDialog('preview', file)}
									title="Preview"
								>
									<Eye class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Preview '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if file.canRename}
								<button
									type="button"
									class={actionClass}
									onclick={() => openDialog('rename', file)}
									title="Rename"
								>
									<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Rename '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if file.canAttach}
								<button
									type="button"
									class={actionClass}
									onclick={() => openDialog('attach', file)}
									title="Attach to a person"
								>
									<Link class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Attach '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if file.canMove}
								<button
									type="button"
									class={actionClass}
									onclick={() => openDialog('move', file)}
									title="Move to another person"
								>
									<ArrowRightLeft class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Move '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if file.canDetach}
								<button
									type="button"
									class={actionClass}
									onclick={() => detach(file)}
									title="Unlink from person"
								>
									<Unlink class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Detach '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if file.canDelete}
								<button
									type="button"
									class="{actionClass} text-red-700"
									onclick={() => openDialog('delete', file)}
									title="Delete permanently"
								>
									<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
									<span class="sr-only">{'Delete '}{file.title ?? 'file'}</span>
								</button>
							{/if}
							{#if !file.canPreview}
								<span class="px-2 py-1 text-stone-500">Details only</span>
							{/if}
						</div>
					</td>
				</tr>
			{:else}
				{#if !isLoading}
					<tr>
						<td colspan="9" class="px-3 py-6 text-center text-stone-500">No files to show.</td>
					</tr>
				{/if}
			{/each}
		</tbody>
	</table>
</div>

{#if nextCursor}
	<div class="mt-3 flex justify-center">
		<button
			type="button"
			onclick={loadMore}
			disabled={isLoading}
			class="rounded-lg border border-stone-300 px-4 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
		>
			Load more files
		</button>
	</div>
{/if}

{#if canManage}
	<section class="mt-10 max-w-4xl" aria-labelledby="unlinked-heading">
		<h3 id="unlinked-heading" class="text-lg font-bold text-stone-900">
			Stored files with no record
		</h3>
		<p class="mt-1 text-xs text-stone-600">
			Files in storage that no record points at, such as one left by a failed upload or a deleted
			tree. Files uploaded in the last hour are left out, since an upload may still be in progress.
		</p>
		<button
			type="button"
			onclick={checkUnlinked}
			disabled={isCheckingUnlinked}
			class="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
		>
			<Search class="h-3.5 w-3.5" aria-hidden="true" />
			{isCheckingUnlinked ? 'Checking…' : 'Check storage'}
		</button>

		{#if unlinked}
			{#if unlinked.files.length === 0}
				<p class="mt-3 text-xs text-stone-600">Nothing is stored without a record.</p>
			{:else}
				<p class="mt-3 text-xs text-stone-700">
					{unlinked.files.length} stored files, {formatMediaSize(unlinked.totalBytes)} in all.
				</p>
				<div class="mt-2 overflow-x-auto rounded-xl border border-stone-200 bg-white">
					<table class="w-full text-left text-xs">
						<caption class="sr-only">Stored files with no record</caption>
						<thead class="border-b border-stone-200 bg-stone-50 text-stone-600">
							<tr>
								<th scope="col" class="px-3 py-2 font-semibold">Storage key</th>
								<th scope="col" class="px-3 py-2 font-semibold">Tree</th>
								<th scope="col" class="px-3 py-2 text-right font-semibold">Size</th>
								<th scope="col" class="px-3 py-2 font-semibold">Uploaded</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-stone-100">
							{#each unlinked.files as stored (stored.key)}
								<tr>
									<td class="px-3 py-2 font-mono break-all text-stone-700">{stored.key}</td>
									<td class="px-3 py-2 text-stone-600">{stored.treeName}</td>
									<td class="px-3 py-2 text-right text-stone-600 tabular-nums"
										>{formatMediaSize(stored.sizeBytes)}</td
									>
									<td class="px-3 py-2 whitespace-nowrap text-stone-600"
										>{formatDate(stored.uploadedAt)}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<button
					type="button"
					data-testid="unlinked-delete"
					onclick={() => openDialog('unlinked')}
					class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
				>
					<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
					Delete these {unlinked.files.length} stored files
				</button>
			{/if}
		{/if}
	</section>
{/if}

<!-- Upload: the file goes to the person chosen; the server checks the caller may add media to them. -->
<BaseModal
	isOpen={dialog === 'upload'}
	title="Add a file"
	icon={Upload}
	error={dialogError}
	onclose={closeDialog}
>
	<form
		class="space-y-4"
		onsubmit={(event) => {
			event.preventDefault();
			void uploadTo();
		}}
	>
		<div>
			<label for="upload-file" class="block text-xs font-semibold text-stone-700">File</label>
			<input
				id="upload-file"
				type="file"
				accept={MEDIA_UPLOAD_ACCEPT}
				onchange={(event) =>
					(uploadFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null)}
				class="mt-1 text-xs"
			/>
		</div>
		<PersonPicker
			{treeId}
			label="Attach to person"
			picked={chosenPerson}
			onpick={(person) => (chosenPerson = person)}
		/>
		<div class="flex justify-end gap-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={closeDialog}
				class="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600">Cancel</button
			>
			<button
				type="submit"
				disabled={isBusy || !uploadFile || !chosenPerson}
				class="btn-primary-sm"
			>
				{isBusy ? 'Uploading…' : 'Upload'}
			</button>
		</div>
	</form>
</BaseModal>

<BaseModal
	isOpen={dialog === 'rename'}
	title="Rename file"
	icon={Pencil}
	error={dialogError}
	onclose={closeDialog}
>
	<form class="space-y-4" onsubmit={rename}>
		<div>
			<label for="rename-title" class="block text-xs font-semibold text-stone-700">Name</label>
			<input
				id="rename-title"
				type="text"
				bind:value={renameTitle}
				class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-sm"
			/>
		</div>
		<div class="flex justify-end gap-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={closeDialog}
				class="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600">Cancel</button
			>
			<button type="submit" disabled={isBusy} class="btn-primary-sm">Save name</button>
		</div>
	</form>
</BaseModal>

<BaseModal
	isOpen={dialog === 'attach' || dialog === 'move'}
	title={dialog === 'move' ? 'Move file' : 'Attach file'}
	icon={dialog === 'move' ? ArrowRightLeft : Link}
	error={dialogError}
	onclose={closeDialog}
>
	<div class="space-y-4">
		<p class="text-xs text-stone-600">
			{dialog === 'move' ? 'Move' : 'Attach'}
			<span class="font-semibold">{target?.title ?? 'this file'}</span>
			to a person in {target?.treeName ?? 'this tree'}.
		</p>
		{#if target}
			<PersonPicker
				treeId={target.treeId}
				label="Person"
				picked={chosenPerson}
				onpick={(person) => (chosenPerson = person)}
			/>
		{/if}
		<div class="flex justify-end gap-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={closeDialog}
				class="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600">Cancel</button
			>
			<button
				type="button"
				disabled={isBusy || !chosenPerson}
				onclick={dialog === 'move' ? moveTo : attachTo}
				class="btn-primary-sm"
			>
				{dialog === 'move' ? 'Move here' : 'Attach'}
			</button>
		</div>
	</div>
</BaseModal>

<BaseModal
	isOpen={dialog === 'delete'}
	title="Delete file permanently"
	icon={Trash2}
	iconBgClass="bg-red-100"
	iconBorderClass="border-red-300"
	iconTextClass="text-red-700"
	error={dialogError}
	onclose={closeDialog}
>
	<div class="space-y-4 text-xs text-stone-700">
		<p>
			<span class="font-semibold">{target?.title ?? 'This file'}</span> will be removed from its record
			and from storage.
		</p>
		<p class="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
			This cannot be undone, and cannot be undone from the history either. Earlier changes that
			involved this file can no longer be undone.
		</p>
		<div class="flex justify-end gap-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={closeDialog}
				disabled={isBusy}
				class="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600">Cancel</button
			>
			<button
				type="button"
				onclick={removeFile}
				disabled={isBusy}
				class="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
			>
				{isBusy ? 'Deleting…' : 'Delete permanently'}
			</button>
		</div>
	</div>
</BaseModal>

<BaseModal
	isOpen={dialog === 'unlinked'}
	title="Delete stored files"
	icon={Trash2}
	iconBgClass="bg-red-100"
	iconBorderClass="border-red-300"
	iconTextClass="text-red-700"
	error={dialogError}
	onclose={closeDialog}
>
	<div class="space-y-4 text-xs text-stone-700">
		<p class="rounded-lg border border-red-300 bg-red-50 p-3 text-red-900">
			This deletes the stored files listed, for good. It cannot be undone. Storage is checked again
			before anything is deleted, so a file that gained a record in the meantime is kept.
		</p>
		<div class="flex justify-end gap-2 border-t border-stone-200 pt-3">
			<button
				type="button"
				onclick={closeDialog}
				disabled={isBusy}
				class="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-600">Cancel</button
			>
			<button
				type="button"
				onclick={clearUnlinked}
				disabled={isBusy}
				class="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
			>
				{isBusy ? 'Deleting…' : 'Delete stored files'}
			</button>
		</div>
	</div>
</BaseModal>

<BaseModal
	isOpen={dialog === 'preview'}
	title={target?.title ?? 'File'}
	icon={Eye}
	maxWidthClass="max-w-3xl"
	onclose={closeDialog}
>
	{#snippet headerExtra()}
		<button
			type="button"
			class={actionClass}
			title="Close preview"
			onclick={closeDialog}
			data-testid="preview-close"
		>
			<X class="h-4 w-4" aria-hidden="true" />
			<span class="sr-only">Close preview</span>
		</button>
	{/snippet}
	<div class="space-y-3 text-xs text-stone-700">
		{#if target?.previewKey && isInlineMediaType(target.mimeType)}
			<img
				src={mediaUrl(target.previewKey)}
				alt={target.title ?? 'Stored file'}
				class="max-h-[70vh] w-full object-contain"
			/>
		{:else if target?.previewKey && target.mimeType === 'application/pdf'}
			<p>PDF files open as a download rather than on this page.</p>
			<a
				href={mediaUrl(target.previewKey)}
				download={target.title ?? 'file.pdf'}
				class="inline-flex items-center gap-1.5 font-semibold text-emerald-800 underline"
			>
				<Download class="h-3.5 w-3.5" aria-hidden="true" />
				Download {target.title ?? 'the PDF'}
			</a>
		{:else}
			<p>This type of file has no preview.</p>
		{/if}
	</div>
</BaseModal>
