<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { Globe, GlobeLock, Pencil, Plus, Star, StarOff, Trash2 } from '@lucide/svelte';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import PublicTreeModal from '#lib/components/modals/PublicTreeModal.svelte';
	import RenameTreeModal from '#lib/components/modals/RenameTreeModal.svelte';
	import { getTreeContext } from '#lib/components/tree/tree-context.js';
	import { DATA_KEY } from '#lib/services/load-helpers.js';
	import {
		deleteTreeApi,
		renameTreeApi,
		saveDefaultTree,
		setPublicTreeApi,
		type InstallTree
	} from '#lib/services/tree-api.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const { toasts, openNewTree } = getTreeContext();

	const isInstallOwner = $derived(data.installTrees !== null);
	// The install list knows nothing of the caller's default; their own list does.
	const defaultTreeId = $derived(data.trees.find((t) => t.isDefault)?.id ?? null);
	const rows = $derived<InstallTree[]>(
		data.installTrees ??
			data.trees.map((t) => ({
				id: t.id,
				name: t.name,
				version: 0,
				role: t.role ?? null,
				ownerNames: [],
				peopleCount: 0,
				memberCount: 0,
				isPublic: false,
				publicSince: null
			}))
	);
	const publicTree = $derived(rows.find((t) => t.isPublic) ?? null);

	// One dialog at a time, so a single target and a single kind describe whichever is open.
	type Dialog = 'rename' | 'delete' | 'public' | null;
	let dialog = $state<Dialog>(null);
	let target = $state<InstallTree | null>(null);
	let isBusy = $state(false);
	let dialogError = $state<string | null>(null);

	function open(kind: Exclude<Dialog, null>, tree: InstallTree) {
		target = tree;
		dialogError = null;
		isBusy = false;
		dialog = kind;
	}
	function close() {
		dialog = null;
	}

	async function run(work: () => Promise<void>, done: string, isLeavingTree = false) {
		isBusy = true;
		dialogError = null;
		try {
			await work();
			dialog = null;
			toasts.push(done);
			// Reloading would ask for the tree this page sits in after it was deleted, and fail.
			if (isLeavingTree) await goto('/', { invalidateAll: true });
			else await invalidate(DATA_KEY);
		} catch (cause) {
			dialogError = (cause as Error).message || 'That did not work';
		} finally {
			isBusy = false;
		}
	}

	const rename = (name: string, version: number) =>
		run(() => renameTreeApi(target!.id, name, version), 'Tree renamed');
	const remove = () =>
		run(() => deleteTreeApi(target!.id), 'Tree deleted', target!.id === data.summary.tree.id);
	const setPublic = (confirmName: string) =>
		run(
			() => setPublicTreeApi(target!.isPublic ? null : target!.id, confirmName),
			target!.isPublic ? 'Tree is now private' : 'Tree is now public'
		);

	async function setDefault(tree: InstallTree) {
		if (isBusy) return;
		const isClearing = tree.id === defaultTreeId;
		isBusy = true;
		try {
			await saveDefaultTree(isClearing ? null : tree.id);
			toasts.push(
				isClearing ? 'No default tree; Epoch opens your latest' : `${tree.name} opens first now`
			);
			await invalidate(DATA_KEY);
		} catch (cause) {
			toasts.push((cause as Error).message || 'Could not change the default tree', {
				tone: 'error'
			});
		} finally {
			isBusy = false;
		}
	}

	const roleLabel = (role: InstallTree['role']) => role ?? 'Not a member';
	const actionClass =
		'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-700 focus-ring hover:bg-stone-200/70 disabled:cursor-default disabled:opacity-50 coarse:min-h-11';
</script>

<svelte:head>
	<title>Trees · {data.summary.tree.name} · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-wrap items-end justify-between gap-3">
	<div>
		<h2 class="text-2xl font-bold text-stone-900">Trees</h2>
		<p class="mt-1 max-w-2xl text-sm text-stone-600">
			Your default tree is the one Epoch opens when you sign in or select the Epoch mark.
			{#if isInstallOwner}
				Every tree in this Epoch is listed. Only one can be public.
				{#if publicTree}
					<span class="font-medium">"{publicTree.name}"</span> is public now.
				{:else}
					No tree is public.
				{/if}
			{/if}
		</p>
	</div>
	<button
		type="button"
		onclick={openNewTree}
		class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-amber-50 shadow-sm focus-ring hover:bg-emerald-700 coarse:min-h-11"
	>
		<Plus class="h-3.5 w-3.5" aria-hidden="true" />
		New tree
	</button>
</div>

<div class="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
	<table class="w-full text-left text-xs {isInstallOwner ? 'min-w-[44rem]' : ''}">
		<thead class="border-b border-stone-200 bg-stone-50 text-stone-600">
			<tr>
				<th scope="col" class="px-3 py-2 font-semibold">Name</th>
				<th scope="col" class="px-3 py-2 font-semibold">Your role</th>
				{#if isInstallOwner}
					<th scope="col" class="px-3 py-2 font-semibold">Owners</th>
					<th scope="col" class="px-3 py-2 text-right font-semibold">People</th>
					<th scope="col" class="px-3 py-2 text-right font-semibold">Members</th>
				{/if}
				<th scope="col" class="px-3 py-2 font-semibold"><span class="sr-only">Actions</span></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-stone-100">
			{#each rows as tree (tree.id)}
				<tr>
					<th scope="row" class="px-3 py-2 font-semibold text-stone-900">
						<span class="inline-flex flex-wrap items-center gap-2">
							{#if tree.role}
								<a href="/trees/{encodeURIComponent(tree.id)}" class="hover:underline"
									>{tree.name}</a
								>
							{:else}
								{tree.name}
							{/if}
							{#if tree.id === defaultTreeId}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-900"
								>
									<Star class="h-3 w-3" aria-hidden="true" />
									Default
								</span>
							{/if}
							{#if tree.isPublic}
								<span
									class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-900"
								>
									<Globe class="h-3 w-3" aria-hidden="true" />
									Public
								</span>
							{/if}
						</span>
					</th>
					<td class="px-3 py-2 text-stone-600 capitalize">{roleLabel(tree.role)}</td>
					{#if isInstallOwner}
						<td class="px-3 py-2 text-stone-600">
							{tree.ownerNames.length ? tree.ownerNames.join(', ') : '—'}
						</td>
						<td class="px-3 py-2 text-right tabular-nums">{tree.peopleCount}</td>
						<td class="px-3 py-2 text-right tabular-nums">{tree.memberCount}</td>
					{/if}
					<td class="px-3 py-2">
						<div class="flex flex-wrap justify-end gap-1">
							<!-- Only a membership can carry the choice, so a tree the owner merely administers has none. -->
							{#if tree.role}
								<button
									type="button"
									class={actionClass}
									disabled={isBusy}
									onclick={() => setDefault(tree)}
								>
									{#if tree.id === defaultTreeId}
										<StarOff class="h-3.5 w-3.5" aria-hidden="true" />
										Unset default<span class="sr-only"> {tree.name}</span>
									{:else}
										<Star class="h-3.5 w-3.5" aria-hidden="true" />
										Make default<span class="sr-only"> {tree.name}</span>
									{/if}
								</button>
							{/if}
							{#if isInstallOwner}
								<button type="button" class={actionClass} onclick={() => open('rename', tree)}>
									<Pencil class="h-3.5 w-3.5" aria-hidden="true" />
									Rename<span class="sr-only"> {tree.name}</span>
								</button>
								<button type="button" class={actionClass} onclick={() => open('public', tree)}>
									{#if tree.isPublic}
										<GlobeLock class="h-3.5 w-3.5" aria-hidden="true" />
										Make private<span class="sr-only"> {tree.name}</span>
									{:else}
										<Globe class="h-3.5 w-3.5" aria-hidden="true" />
										Make public<span class="sr-only"> {tree.name}</span>
									{/if}
								</button>
								<button
									type="button"
									class="{actionClass} text-red-700"
									onclick={() => open('delete', tree)}
								>
									<Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
									Delete<span class="sr-only"> {tree.name}</span>
								</button>
							{/if}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

{#if target}
	<RenameTreeModal
		isOpen={dialog === 'rename'}
		treeName={target.name}
		treeVersion={target.version}
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
