<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import PageTabs from '#lib/components/layout/PageTabs.svelte';
	import ReorderHandle from '#lib/components/forms/ReorderHandle.svelte';
	import { hashTab } from '#lib/components/layout/hash-tab.js';
	import { Download, Globe, GlobeLock, Pencil, Settings, Trash2 } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import PublicTreeModal from '#lib/components/modals/PublicTreeModal.svelte';
	import RenameTreeModal from '#lib/components/modals/RenameTreeModal.svelte';
	import MapsSettingsForm from '#lib/components/settings/MapsSettingsForm.svelte';
	import PaletteEditor from '#lib/components/settings/PaletteEditor.svelte';
	import { saveSiteSettings } from '#lib/api/settings.js';
	import {
		deleteTreeApi,
		renameTreeApi,
		reorderTreesApi,
		setPublicTreeApi
	} from '#lib/api/trees.js';
	import type { InstallTree } from '#lib/shared/api-contracts.js';
	import { SETTINGS_DEPENDENCY, type SettingsPatch } from '#lib/shared/settings.js';
	import { isManagerOrAbove } from '#lib/shared/roles.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const TABS = [
		{ id: 'trees', label: 'Trees' },
		{ id: 'appearance', label: 'Site appearance' },
		{ id: 'maps', label: 'Maps' }
	] as const;
	const tab = $derived(hashTab(page.url.hash, ['trees', 'appearance', 'maps']));

	const toasts = new ToastStore();
	const rows = $derived(data.installTrees);
	const publicTree = $derived(rows.find((t) => t.isPublic) ?? null);
	const rowIds = $derived(rows.map((t) => t.id));
	// A single tree has no order to change, so its handle would do nothing.
	const canReorder = $derived(rows.length > 1);

	// One dialog at a time, so a single target and a single kind describe whichever is open.
	type Dialog = 'rename' | 'delete' | 'public' | null;
	let dialog = $state<Dialog>(null);
	let target = $state<InstallTree | null>(null);
	let isBusy = $state(false);
	let dialogError = $state<string | null>(null);
	let isReordering = $state(false);

	function open(kind: Exclude<Dialog, null>, tree: InstallTree) {
		target = tree;
		dialogError = null;
		isBusy = false;
		dialog = kind;
	}
	function close() {
		dialog = null;
	}

	async function run(work: () => Promise<void>, done: string) {
		isBusy = true;
		dialogError = null;
		try {
			await work();
			dialog = null;
			toasts.push(done);
			await invalidateAll();
		} catch (cause) {
			dialogError = messageOf(cause, 'That did not work');
		} finally {
			isBusy = false;
		}
	}

	const rename = (name: string, slug: string | null, version: number, isOnSubdomain?: boolean) =>
		run(
			() => renameTreeApi(target!.id, name, slug, version, isOnSubdomain).then(() => undefined),
			'Tree renamed'
		);
	const remove = () => run(() => deleteTreeApi(target!.id), 'Tree deleted');
	const setPublic = (confirmName: string) =>
		run(
			() => setPublicTreeApi(target!.isPublic ? null : target!.id, confirmName),
			target!.isPublic ? 'Tree is now private' : 'Tree is now public'
		);

	// Awaited by the handle so focus returns only after the reload. No dialog is open to show errors.
	async function reorder(ids: string[]) {
		isReordering = true;
		try {
			await reorderTreesApi(ids);
			await invalidateAll();
		} catch (cause) {
			toasts.push(messageOf(cause, 'Could not save the tree order'), { tone: 'error' });
		} finally {
			isReordering = false;
		}
	}

	async function saveSite(patch: SettingsPatch) {
		await saveSiteSettings(patch);
		await invalidate(SETTINGS_DEPENDENCY);
	}

	const roleLabel = (role: InstallTree['role']) => role ?? 'Not a member';
	// Below lg each row is a card: the table's own display values are swapped out so one set of
	// cells serves both layouts, and `data-label` names the figure the header would have.
	const cellClass =
		'text-stone-600 before:text-stone-500 before:normal-case before:content-[attr(data-label)] max-lg:before:mr-1 lg:table-cell lg:px-3 lg:py-2 lg:before:content-none';
</script>

<svelte:head>
	<title>Administration · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-col gap-6">
	<header>
		<h1 class="text-2xl font-bold text-stone-900">Administration</h1>
		<p class="mt-1 text-sm text-stone-600">
			What belongs to the whole Epoch install, which only you can change as its owner.
		</p>
	</header>

	<div>
		<PageTabs
			label="Administration"
			tabs={TABS.map((t) => ({ href: `#${t.id}`, label: t.label, isCurrent: t.id === tab }))}
		/>
		{#if tab === 'trees'}
			<section id="trees-tab" aria-label="Trees" class="flex scroll-mt-24 flex-col gap-3">
				<p class="max-w-2xl text-sm text-stone-600">
					Every tree in this Epoch is listed. Only one can be public.
					{#if publicTree}
						<span class="font-medium">"{publicTree.name}"</span> is public now.
					{:else}
						No tree is public.
					{/if}
				</p>
				<div class="rounded-xl border border-stone-200 bg-white shadow-xs lg:overflow-x-auto">
					<table class="block w-full text-left text-xs lg:table">
						<thead
							class="hidden border-b border-stone-200 bg-stone-50 text-stone-600 lg:table-header-group"
						>
							<tr>
								<th scope="col" class="w-0 px-1 py-2 font-semibold"
									><span class="sr-only">Reorder</span></th
								>
								<th scope="col" class="px-3 py-2 font-semibold">Name</th>
								<th scope="col" class="px-3 py-2 font-semibold">Your role</th>
								<th scope="col" class="px-3 py-2 font-semibold">Owners</th>
								<th scope="col" class="px-3 py-2 text-right font-semibold">People</th>
								<th scope="col" class="px-3 py-2 text-right font-semibold">Members</th>
								<th scope="col" class="px-3 py-2 font-semibold"
									><span class="sr-only">Actions</span></th
								>
							</tr>
						</thead>
						<tbody class="block divide-y divide-stone-100 lg:table-row-group">
							{#each rows as tree (tree.id)}
								<tr
									class="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 lg:table-row lg:p-0"
									data-reorder-id={tree.id}
								>
									<td class="lg:table-cell lg:px-1 lg:py-2 {canReorder ? '' : 'max-lg:hidden'}">
										{#if canReorder}
											<ReorderHandle
												id={tree.id}
												name={tree.name}
												ids={rowIds}
												isDisabled={isReordering}
												onreorder={reorder}
											/>
										{/if}
									</td>
									<th
										scope="row"
										class="min-w-0 text-left font-semibold text-stone-900 max-lg:flex-1 lg:table-cell lg:w-auto lg:px-3 lg:py-2"
									>
										<span class="inline-flex flex-wrap items-center gap-2">
											{#if tree.role}
												<a href={treePath(tree)} class="hover:underline">{tree.name}</a>
											{:else}
												{tree.name}
											{/if}
											{#if tree.isPublic}
												<span
													class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900"
												>
													<Globe class="h-3 w-3" aria-hidden="true" />
													Public
												</span>
											{/if}
										</span>
									</th>
									<td class="{cellClass} capitalize" data-label="Your role:"
										>{roleLabel(tree.role)}</td
									>
									<td class={cellClass} data-label="Owners:">
										{tree.ownerNames.length ? tree.ownerNames.join(', ') : '—'}
									</td>
									<td class="{cellClass} tabular-nums lg:text-right" data-label="People:">
										{tree.peopleCount}
									</td>
									<td class="{cellClass} tabular-nums lg:text-right" data-label="Members:">
										{tree.memberCount}
									</td>
									<td
										class="w-full max-lg:border-t max-lg:border-stone-100 max-lg:pt-2 lg:table-cell lg:w-px lg:px-3 lg:py-2 lg:whitespace-nowrap"
									>
										<div
											class="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap lg:flex-nowrap lg:justify-end"
										>
											{#if isManagerOrAbove(tree.role ?? undefined)}
												<a href="{treePath(tree)}/settings" class="row-action">
													<Settings aria-hidden="true" />
													Settings<span class="sr-only"> for {tree.name}</span>
												</a>
												<!-- Export needs tree:export, which is manager and above, the same gate as Settings. -->
												<a href="{treePath(tree)}/settings#export" class="row-action">
													<Download aria-hidden="true" />
													Export<span class="sr-only"> {tree.name}</span>
												</a>
											{/if}
											<button type="button" class="row-action" onclick={() => open('rename', tree)}>
												<Pencil aria-hidden="true" />
												Rename<span class="sr-only"> {tree.name}</span>
											</button>
											<button type="button" class="row-action" onclick={() => open('public', tree)}>
												{#if tree.isPublic}
													<GlobeLock aria-hidden="true" />
													<span aria-hidden="true">Make private</span><span class="sr-only"
														>Make {tree.name} private</span
													>
												{:else}
													<Globe aria-hidden="true" />
													<span aria-hidden="true">Make public</span><span class="sr-only"
														>Make {tree.name} public</span
													>
												{/if}
											</button>
											<button
												type="button"
												class="row-action-danger"
												onclick={() => open('delete', tree)}
											>
												<Trash2 aria-hidden="true" />
												Delete<span class="sr-only"> {tree.name}</span>
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else if tab === 'maps'}
			<section id="maps-tab" aria-label="Maps" class="flex max-w-3xl scroll-mt-24 flex-col gap-3">
				<p class="text-sm text-stone-600">
					Where Epoch finds places and draws maps. The defaults use free OpenStreetMap services;
					change them to use your own.
				</p>
				<MapsSettingsForm stored={data.settings.site.maps} onsave={saveSite} />
			</section>
		{:else}
			<section
				id="appearance-tab"
				aria-label="Site appearance"
				class="flex max-w-3xl scroll-mt-24 flex-col gap-3"
			>
				<p class="text-sm text-stone-600">
					What everyone sees who has not chosen their own colours, including readers of the public
					tree.
				</p>
				<PaletteEditor
					idPrefix="site"
					stored={data.settings.site}
					below={[]}
					inheritedName="the built-in colours"
					onsave={saveSite}
				/>
			</section>
		{/if}
	</div>
</div>

{#if target}
	<RenameTreeModal
		isOpen={dialog === 'rename'}
		treeName={target.name}
		treeSlug={target.slug}
		treeVersion={target.version}
		isOnSubdomain={target.isOnSubdomain}
		subdomainZone={data.subdomainZone}
		isRenaming={isBusy}
		error={dialogError}
		onclose={close}
		onrename={rename}
	/>
	<DeleteTreeModal
		isOpen={dialog === 'delete'}
		treeId={target.id}
		treeName={target.name}
		isDeleting={isBusy}
		error={dialogError}
		onclose={close}
		ondelete={remove}
	/>
	<PublicTreeModal
		isOpen={dialog === 'public'}
		treeName={target.name}
		isWithdrawing={target.isPublic}
		replacedName={publicTree && publicTree.id !== target.id ? publicTree.name : null}
		isSaving={isBusy}
		error={dialogError}
		onclose={close}
		onconfirm={setPublic}
	/>
{/if}
<ToastHost store={toasts} />
