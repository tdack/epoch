<script lang="ts">
	import { invalidate, invalidateAll } from '$app/navigation';
	import { Globe, GlobeLock, Pencil, Trash2 } from '@lucide/svelte';
	import { messageOf } from '#lib/components/feedback/error-message.js';
	import ToastHost from '#lib/components/feedback/ToastHost.svelte';
	import { ToastStore } from '#lib/components/feedback/toasts.svelte.js';
	import DeleteTreeModal from '#lib/components/modals/DeleteTreeModal.svelte';
	import PublicTreeModal from '#lib/components/modals/PublicTreeModal.svelte';
	import RenameTreeModal from '#lib/components/modals/RenameTreeModal.svelte';
	import PaletteEditor from '#lib/components/settings/PaletteEditor.svelte';
	import { saveSiteSettings } from '#lib/api/settings.js';
	import { deleteTreeApi, renameTreeApi, setPublicTreeApi } from '#lib/api/trees.js';
	import type { InstallTree } from '#lib/shared/api-contracts.js';
	import { SETTINGS_DEPENDENCY, type SettingsPatch } from '#lib/shared/settings.js';
	import { treePath } from '#lib/shared/tree-slug.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const toasts = new ToastStore();
	const rows = $derived(data.installTrees);
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

	async function saveSite(patch: SettingsPatch) {
		await saveSiteSettings(patch);
		await invalidate(SETTINGS_DEPENDENCY);
	}

	const roleLabel = (role: InstallTree['role']) => role ?? 'Not a member';
	const actionClass =
		'inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-stone-700 focus-ring hover:bg-stone-200/70 disabled:cursor-default disabled:opacity-50 coarse:min-h-11';
</script>

<svelte:head>
	<title>Administration · Epoch</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex flex-col gap-10">
	<header>
		<h1 class="text-2xl font-bold text-stone-900">Administration</h1>
		<p class="mt-1 text-sm text-stone-600">
			What belongs to the whole Epoch install, which only you can change as its owner.
		</p>
	</header>

	<section id="trees" aria-labelledby="trees-heading" class="flex scroll-mt-24 flex-col gap-3">
		<h2 id="trees-heading" class="text-lg font-bold text-stone-900">Trees</h2>
		<p class="max-w-2xl text-sm text-stone-600">
			Every tree in this Epoch is listed. Only one can be public.
			{#if publicTree}
				<span class="font-medium">"{publicTree.name}"</span> is public now.
			{:else}
				No tree is public.
			{/if}
		</p>
		<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-xs">
			<table class="w-full min-w-[44rem] text-left text-xs">
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
					{#each rows as tree (tree.id)}
						<tr>
							<th scope="row" class="px-3 py-2 font-semibold text-stone-900">
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
	</section>

	<section
		id="appearance"
		aria-labelledby="appearance-heading"
		class="flex scroll-mt-24 flex-col gap-3"
	>
		<h2 id="appearance-heading" class="text-lg font-bold text-stone-900">Site appearance</h2>
		<p class="text-sm text-stone-600">
			What everyone sees who has not chosen their own colours, including readers of the public tree.
		</p>
		<PaletteEditor
			idPrefix="site"
			stored={data.settings.site}
			below={[]}
			inheritedName="the built-in colours"
			onsave={saveSite}
		/>
	</section>
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
