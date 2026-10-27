<script lang="ts">
	import TreeAdminTabs from '#lib/components/layout/TreeAdminTabs.svelte';
	import { hashTab } from '#lib/components/layout/hash-tab.js';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { invalidate } from '$app/navigation';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import GedcomExportChoices from '#lib/components/settings/GedcomExportChoices.svelte';
	import VisibilitySettings from '#lib/components/settings/VisibilitySettings.svelte';
	import SubtreeManager from '#lib/components/subtree/SubtreeManager.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { deleteTreeApi, renameTreeApi } from '#lib/api/trees.js';
	import type { GedcomExportChoice } from '#lib/api/files.js';
	import { DATE_FORMATS, DATE_FORMAT_LABELS, type DateFormat } from '#lib/shared/date-display.js';
	import { DATA_KEY } from '#lib/shared/data-key.js';
	import { appHref } from '#lib/shared/tree-host.js';
	import { MAX_TREE_SLUG_LENGTH, isValidTreeSlug, treePath } from '#lib/shared/tree-slug.js';
	import type { PageData } from './$types';

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();
	const context = getTreeContext();
	const { toasts } = context;

	const tree = $derived(data.summary.tree);
	const viewer = $derived(data.summary.viewer);
	const zone = $derived(data.subdomainZone);
	// Sub-trees and Export are tabs of this page; old links to a section of Settings still land on it.
	const tab = $derived(
		hashTab<'settings' | 'subtrees' | 'export'>(page.url.hash, ['settings', 'subtrees', 'export'], {
			general: 'settings',
			address: 'settings',
			visibility: 'settings',
			delete: 'settings'
		})
	);

	// The fields start from the tree as loaded and are the source of truth until the next visit.
	let name = $state(untrack(() => data.summary.tree.name));
	let slug = $state(untrack(() => data.summary.tree.slug ?? ''));
	let isOnSubdomain = $state(untrack(() => data.summary.tree.isOnSubdomain));
	let dateFormat = $state<DateFormat>(untrack(() => data.summary.tree.dateFormat));
	let isSaving = $state(false);
	let nameError = $state<string | null>(null);
	let addressError = $state<string | null>(null);
	// The subdomain is the address, so it is offered only while there is one.
	const hasAddress = $derived(slug.trim() !== '');

	async function save(
		nextName: string,
		nextSlug: string | null,
		isNextOnSubdomain?: boolean,
		nextDateFormat?: DateFormat
	) {
		isSaving = true;
		try {
			const renamed = await renameTreeApi(
				tree.id,
				nextName,
				nextSlug,
				tree.version,
				isNextOnSubdomain,
				nextDateFormat
			);
			toasts.push('Tree saved');
			const isMoved = renamed.slug !== tree.slug || renamed.isOnSubdomain !== tree.isOnSubdomain;
			if (isMoved) await context.followAddress(renamed);
			else await invalidate(DATA_KEY);
			return true;
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not save the tree'), { tone: 'error' });
			return false;
		} finally {
			isSaving = false;
		}
	}

	function saveName(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		nameError = trimmed ? null : 'Enter a name for the tree.';
		if (!trimmed || trimmed === tree.name || isSaving) return;
		// The address is sent back as it stands, so a name change never moves it.
		void save(trimmed, tree.slug ?? null, zone ? tree.isOnSubdomain : undefined);
	}

	function saveDateFormat(event: SubmitEvent) {
		event.preventDefault();
		if (isSaving || dateFormat === tree.dateFormat) return;
		// Name and address go back as they stand, so this save changes only the format.
		void save(tree.name, tree.slug ?? null, zone ? tree.isOnSubdomain : undefined, dateFormat);
	}

	function saveAddress(event: SubmitEvent) {
		event.preventDefault();
		const next = slug.trim() || null;
		if (next !== null && !isValidTreeSlug(next)) {
			addressError =
				'Use lower-case letters, digits and single hyphens in the address, such as the-windsors.';
			return;
		}
		addressError = null;
		const isNextOnSubdomain = zone ? next !== null && isOnSubdomain : undefined;
		if (
			isSaving ||
			(next === (tree.slug ?? null) &&
				(isNextOnSubdomain === undefined || isNextOnSubdomain === tree.isOnSubdomain))
		)
			return;
		void save(tree.name, next, isNextOnSubdomain);
	}

	let isExporting = $state(false);
	async function exportGedcom(choice: GedcomExportChoice) {
		if (isExporting) return;
		isExporting = true;
		try {
			await context.exportGedcom(choice);
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not start the export'), { tone: 'error' });
		} finally {
			isExporting = false;
		}
	}

	let isDeleteOpen = $state(false);
	let isDeleting = $state(false);
	let deleteError = $state<string | null>(null);
	async function remove() {
		isDeleting = true;
		deleteError = null;
		try {
			await deleteTreeApi(tree.id);
			toasts.push('Tree deleted');
			isDeleteOpen = false;
			window.location.assign(appHref('/', data.hostTree));
		} catch (cause) {
			deleteError = messageOf(cause, 'Failed to delete tree');
		} finally {
			isDeleting = false;
		}
	}

	const inputClass =
		'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 focus:outline-none disabled:opacity-50';
	const sectionHeadingClass = 'text-lg font-bold text-stone-900';
</script>

<svelte:head>
	<title>Tree settings · {tree.name} · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<TreeAdminTabs
	treeName={tree.name}
	base={treePath({ ...data.summary.tree, subtree: null })}
	current={tab}
	role={viewer.role}
/>
{#if tab === 'settings'}
	<p class="max-w-prose text-sm text-stone-600">
		These settings apply to everyone in {tree.name}. Your own colours and defaults are on your
		<a href={appHref('/account', data.hostTree)} class="text-link">account</a>.
	</p>

	<section id="general" class="mt-8 scroll-mt-20" aria-labelledby="general-heading">
		<h2 id="general-heading" class={sectionHeadingClass}>General</h2>
		<form onsubmit={saveName} class="mt-3 max-w-2xl">
			<label for="tree-name" class="field-label">Tree name</label>
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="tree-name"
					type="text"
					bind:value={name}
					maxlength={200}
					disabled={isSaving}
					aria-invalid={nameError ? 'true' : undefined}
					aria-describedby={nameError ? 'tree-name-error' : undefined}
					class="{inputClass} max-w-md flex-1"
				/>
				<button type="submit" disabled={isSaving} class="btn-primary">Save</button>
			</div>
			{#if nameError}<p id="tree-name-error" class="mt-1 text-xs text-red-700" role="alert">
					{nameError}
				</p>{/if}
		</form>
		<form onsubmit={saveDateFormat} class="mt-6 max-w-2xl">
			<fieldset class="min-w-0" aria-describedby="tree-date-format-help">
				<legend class="field-label">Date format</legend>
				<p id="tree-date-format-help" class="mb-2 text-xs text-stone-600">
					How dates read across this tree. The dates as stored, and any export, do not change.
				</p>
				<div class="space-y-1">
					{#each Object.values(DATE_FORMATS) as format (format)}
						<label class="flex items-center gap-2 text-sm text-stone-800">
							<input
								type="radio"
								name="tree-date-format"
								value={format}
								bind:group={dateFormat}
								disabled={isSaving}
							/>
							{DATE_FORMAT_LABELS[format]}
						</label>
					{/each}
				</div>
			</fieldset>
			<button type="submit" disabled={isSaving} class="btn-primary mt-3">Save</button>
		</form>
	</section>

	<section id="address" class="mt-10 scroll-mt-20" aria-labelledby="address-heading">
		<h2 id="address-heading" class={sectionHeadingClass}>Address</h2>
		<form onsubmit={saveAddress} class="mt-3 max-w-2xl space-y-4">
			<div>
				<label for="tree-slug" class="field-label">Web address</label>
				<div
					class="flex items-center rounded-lg border border-stone-300 bg-white focus-within:border-emerald-600 focus-within:ring-1 focus-within:ring-emerald-600"
				>
					<span class="pl-3 text-sm text-stone-500" aria-hidden="true">/trees/</span>
					<input
						id="tree-slug"
						type="text"
						bind:value={slug}
						maxlength={MAX_TREE_SLUG_LENGTH}
						disabled={isSaving}
						autocomplete="off"
						spellcheck="false"
						placeholder="the-windsors"
						aria-describedby="tree-slug-help"
						class="w-full min-w-0 rounded-r-lg bg-transparent py-2 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none disabled:opacity-50"
					/>
				</div>
				<p id="tree-slug-help" class="mt-1 text-xs text-stone-600">
					Renaming the tree keeps the address, so bookmarks still work. Changing the address breaks
					links to the old one. Leave it empty to use the tree's id.
				</p>
			</div>

			{#if zone}
				<div>
					<label class="flex items-start gap-2 text-sm text-stone-800">
						<input
							type="checkbox"
							bind:checked={isOnSubdomain}
							disabled={isSaving || !hasAddress}
							aria-describedby="tree-subdomain-help"
							class="mt-0.5"
						/>
						<span>
							Also open this tree at
							<span class="font-mono text-stone-900"
								>{hasAddress ? slug.trim() : 'address'}.{zone}</span
							>
						</span>
					</label>
					<p id="tree-subdomain-help" class="mt-1 text-xs text-stone-600">
						That address shows this tree and nothing else. Its name becomes visible as a web
						address, even while the tree is private. Changing the address above moves it.
					</p>
				</div>
			{/if}

			{#if addressError}<p class="text-xs text-red-700" role="alert">{addressError}</p>{/if}
			<button type="submit" disabled={isSaving} class="btn-primary">Save address</button>
		</form>
	</section>

	<section id="visibility" class="mt-10 scroll-mt-20" aria-labelledby="visibility-heading">
		<h2 id="visibility-heading" class={sectionHeadingClass}>Visibility</h2>
		<VisibilitySettings treeId={tree.id} settings={data.privacy} {toasts} />
		<div class="mt-4 max-w-prose text-sm text-stone-700">
			<p>
				{#if viewer.isTreePublic}
					<span
						class="mr-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
						>Public</span
					>
					Anyone with the link can read it.
				{:else}
					<span
						class="mr-1 inline-flex items-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700"
						>Not public</span
					>
					Only the people invited to this tree can read it.
				{/if}
				{#if viewer.isInstallOwner}
					You choose the public tree in
					<a href={appHref('/admin#trees', data.hostTree)} class="text-link">Administration</a>.
				{:else}
					The person who runs this Epoch chooses which tree is public.
				{/if}
			</p>
			<p class="mt-2 text-stone-600">
				One person can be made always public or always private on their own page.
			</p>
		</div>
	</section>

	{#if data.canDelete}
		<section id="delete" class="mt-10 scroll-mt-20" aria-labelledby="delete-heading">
			<h2 id="delete-heading" class={sectionHeadingClass}>Delete this tree</h2>
			<p class="mt-1 max-w-prose text-sm text-stone-600">
				Deletes {tree.name} and everything in it, for everyone. You confirm by typing its name.
				{#if data.canExport}<a href="#export" class="text-link">Export it first</a> to keep a copy.{/if}
			</p>
			<button
				type="button"
				class="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 focus-ring hover:bg-red-50 coarse:min-h-11"
				onclick={() => {
					deleteError = null;
					isDeleteOpen = true;
				}}
			>
				Delete this tree…
			</button>
		</section>
	{/if}
{:else if tab === 'subtrees' && data.canManageSubtrees}
	<SubtreeManager
		{tree}
		subtrees={data.subtrees}
		rootNames={data.rootNames}
		canManage={data.canManageSubtrees}
		{toasts}
		onchanged={() => invalidate(DATA_KEY)}
	/>
{:else if tab === 'export' && data.canExport}
	<section id="export-tab" class="scroll-mt-20" aria-label="Export">
		<p class="max-w-prose text-sm text-stone-600">
			Download the whole tree as a GEDCOM file. It includes living people.
		</p>
		<GedcomExportChoices {isExporting} onexport={exportGedcom} />
	</section>
{/if}

{#if data.canDelete}
	<DeleteTreeModal
		isOpen={isDeleteOpen}
		treeId={tree.id}
		treeName={tree.name}
		{isDeleting}
		error={deleteError}
		onclose={() => (isDeleteOpen = false)}
		ondelete={remove}
	/>
{/if}
