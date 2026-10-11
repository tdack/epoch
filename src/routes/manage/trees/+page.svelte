<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { Globe, GlobeLock, Pencil, Plus, Trash2 } from '@lucide/svelte';
	import AppHeader from '#lib/components/layout/AppHeader.svelte';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import PublicTreeModal from '#lib/components/modals/PublicTreeModal.svelte';
	import RenameTreeModal from '#lib/components/modals/RenameTreeModal.svelte';
	import TreeShellHost from '#lib/components/tree/TreeShellHost.svelte';
	import { TreeShell } from '#lib/components/tree/tree-shell.svelte.js';
	import {
		deleteTreeApi,
		renameTreeApi,
		setPublicTreeApi,
		type InstallTree
	} from '#lib/services/tree-api.js';

	let { data } = $props();

	const toasts = new ToastStore();
	const shell = new TreeShell({
		treeId: () => null,
		toasts,
		reload: () => invalidateAll(),
		goTo: (id) => void goto(id ? `/trees/${encodeURIComponent(id)}` : '/')
	});

	const publicTree = $derived(data.trees.find((t) => t.isPublic) ?? null);
	// Back to the tree the owner came from, when it still exists.
	const backTree = $derived(data.trees.find((t) => t.id === data.fromTreeId) ?? null);

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

	async function run(work: () => Promise<void>, done: string) {
		isBusy = true;
		dialogError = null;
		try {
			await work();
			dialog = null;
			toasts.push(done);
			await invalidateAll();
		} catch (cause) {
			dialogError = (cause as Error).message || 'That did not work';
		} finally {
			isBusy = false;
		}
	}

	const rename = (name: string, version: number) =>
		run(() => renameTreeApi(target!.id, name, version), 'Tree renamed');
	const remove = () => run(() => deleteTreeApi(target!.id), 'Tree deleted');
	const setPublic = (confirmName: string) =>
		run(
			() => setPublicTreeApi(target!.isPublic ? null : target!.id, confirmName),
			target!.isPublic ? 'Tree is now private' : 'Tree is now public'
		);

	const roleLabel = (role: InstallTree['role']) => role ?? 'Not a member';
	const actionClass =
		'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-700 focus-ring hover:bg-stone-200/70 coarse:min-h-11';
</script>

<svelte:head>
	<title>Trees · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-screen flex-col bg-[#fcf9f2] font-sans text-stone-800">
	<AppHeader
		trees={[]}
		selectedTreeId={null}
		isImporting={shell.isImporting}
		onselectTree={() => {}}
		onopenNewTree={shell.openNewTree}
		onopenDeleteTree={() => {}}
		onopenAddPerson={() => {}}
		onfileSelect={shell.selectFile}
		onexportGedcom={() => {}}
	/>
	<main class="mx-auto flex w-full max-w-5xl flex-1 flex-col space-y-4 p-6">
		<TreeShellHost {shell} tree={null} />
		{#if backTree}
			<a
				href="/trees/{encodeURIComponent(backTree.id)}"
				class="self-start text-xs font-medium text-emerald-800 hover:underline"
			>
				← Back to {backTree.name}
			</a>
		{/if}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="text-2xl font-bold text-stone-900">Trees</h2>
				<p class="mt-1 text-sm text-stone-600">
					Every tree in this Epoch. Only one can be public.
					{#if publicTree}
						<span class="font-medium">"{publicTree.name}"</span> is public now.
					{:else}
						No tree is public.
					{/if}
				</p>
			</div>
			<button
				type="button"
				onclick={shell.openNewTree}
				class="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-semibold text-amber-50 shadow-sm focus-ring hover:bg-emerald-700 coarse:min-h-11"
			>
				<Plus class="h-3.5 w-3.5" aria-hidden="true" />
				New tree
			</button>
		</div>

		<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
			<table class="w-full min-w-[40rem] text-left text-xs">
				<thead class="border-b border-stone-200 bg-stone-50 text-stone-600">
					<tr>
						<th scope="col" class="px-3 py-2 font-semibold">Name</th>
						<th scope="col" class="px-3 py-2 font-semibold">Your role</th>
						<th scope="col" class="px-3 py-2 font-semibold">Owners</th>
						<th scope="col" class="px-3 py-2 text-right font-semibold">People</th>
						<th scope="col" class="px-3 py-2 text-right font-semibold">Members</th>
						<th scope="col" class="px-3 py-2 font-semibold"><span class="sr-only">Actions</span></th
						>
					</tr>
				</thead>
				<tbody class="divide-y divide-stone-100">
					{#each data.trees as tree (tree.id)}
						<tr>
							<th scope="row" class="px-3 py-2 font-semibold text-stone-900">
								<span class="inline-flex items-center gap-2">
									{#if tree.role}
										<a href="/trees/{encodeURIComponent(tree.id)}" class="hover:underline"
											>{tree.name}</a
										>
									{:else}
										{tree.name}
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
							<td class="px-3 py-2 text-stone-600">
								{tree.ownerNames.length ? tree.ownerNames.join(', ') : '—'}
							</td>
							<td class="px-3 py-2 text-right tabular-nums">{tree.peopleCount}</td>
							<td class="px-3 py-2 text-right tabular-nums">{tree.memberCount}</td>
							<td class="px-3 py-2">
								<div class="flex flex-wrap justify-end gap-1">
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
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</main>
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
<ToastHost store={toasts} />
