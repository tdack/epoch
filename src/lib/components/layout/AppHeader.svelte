<script lang="ts">
	import { UserPlus } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import EpochMark from '#lib/components/brand/EpochMark.svelte';
	import TreeSwitcher from '#lib/components/layout/TreeSwitcher.svelte';
	import AvatarMenu from '#lib/components/profile/AvatarMenu.svelte';
	import type { ProfileViewDto } from '#lib/shared/profile.js';
	import type { GedcomExportChoice } from '#lib/api/files.js';
	import type { TreeSummary } from '#lib/types/genealogy.js';
	import type { SubtreeSummaryDto } from '#lib/shared/subtrees.js';

	interface Props {
		trees: TreeSummary[];
		selectedTreeId: string | null;
		/** Counts from the tree summary, shown under the tree's name; omitted where no tree is open. */
		counts?: { people: number; unions: number };
		/** The active sub-tree's name; the counts then describe its members. */
		subtreeName?: string | null;
		isImporting?: boolean;
		/** The selected tree's sub-trees, for the switcher. */
		subtrees?: SubtreeSummaryDto[];
		/** The sub-tree lens in force, if any. */
		activeSubtreeId?: string | null;
		onselectTree: (id: string) => void;
		onselectSubtree?: (subtree: SubtreeSummaryDto) => void;
		onopenNewTree: () => void;
		onopenDeleteTree: () => void;
		/** Absent below manager, who may not rename the tree, so the menu item is not shown. */
		onopenRenameTree?: () => void;
		/** Absent for a viewer, who cannot add anyone, so the button is not shown. */
		onopenAddPerson?: () => void;
		onfileSelect: (e: Event) => void;
		onexportGedcom: (choice: GedcomExportChoice) => void;
		/** Export carries every person, living ones included, so it is offered to managers and owners only. */
		canExport?: boolean;
		/** False for the public visitor, who is offered no way to start, import or delete a tree. */
		canChangeTrees?: boolean;
		/** The person finder, placed between the tree switcher and Add person on tree pages. */
		finder?: Snippet;
		/** Where the Epoch mark leads: `/`, or the app host's `/` on a tree's own subdomain. */
		homeHref?: string;
		/** Who is signed in; absent for the public visitor, who gets no account menu. */
		viewer?: ProfileViewDto | null;
		profileHref?: string;
		settingsHref?: string;
		/** Where Sign out goes (see `signOutHref`); the menu is shown only with it. */
		signOutHref?: string;
	}

	let {
		trees = [],
		selectedTreeId,
		counts,
		subtreeName = null,
		isImporting = false,
		subtrees = [],
		activeSubtreeId = null,
		onselectTree,
		onselectSubtree,
		onopenNewTree,
		onopenDeleteTree,
		onopenRenameTree,
		onopenAddPerson,
		onfileSelect,
		onexportGedcom,
		canExport = false,
		canChangeTrees = true,
		finder,
		homeHref = '/',
		viewer = null,
		profileHref = '/profile',
		settingsHref = '/settings',
		signOutHref
	}: Props = $props();
</script>

<header
	class="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-200/80 bg-[#fdfbf7]/90 px-3 py-2 shadow-xs backdrop-blur-md sm:px-6"
>
	<!-- `/` resolves the viewer's default tree, so the link needs no tree list of its own. -->
	<a href={homeHref} class="flex items-center space-x-3 rounded-xl focus-ring">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-800 shadow-md shadow-emerald-900/15"
		>
			<EpochMark size={26} ink="#fffbeb" ancestryOpacity={0.5} />
		</div>
		<!-- sr-only below lg, not hidden: the page keeps its h1 where the wordmark has no room. -->
		<div class="sr-only lg:not-sr-only">
			<h1 class="text-base font-bold tracking-tight text-stone-900">Epoch</h1>
			<p class="text-xs font-medium tracking-wide text-stone-500">Family history</p>
		</div>
	</a>

	<TreeSwitcher
		{trees}
		{selectedTreeId}
		{counts}
		{subtreeName}
		{isImporting}
		{subtrees}
		{activeSubtreeId}
		{onselectTree}
		{onselectSubtree}
		{onopenNewTree}
		{onopenDeleteTree}
		{onopenRenameTree}
		{onfileSelect}
		{onexportGedcom}
		{canExport}
		{canChangeTrees}
	/>

	<!-- Wraps to its own full-width row on phones so the finder keeps room to type. -->
	<div class="order-last w-full sm:order-none sm:w-auto sm:max-w-md sm:min-w-56 sm:flex-1">
		{@render finder?.()}
	</div>

	<div class="ml-auto flex items-center gap-3">
		{#if selectedTreeId && onopenAddPerson}
			<button
				type="button"
				onclick={onopenAddPerson}
				aria-label="Add person"
				class="btn-primary-sm space-x-1.5 px-2.5 focus-ring sm:px-3 coarse:min-h-11"
			>
				<UserPlus class="h-3.5 w-3.5" />
				<span class="hidden sm:inline">Add person</span>
			</button>
		{/if}
		{#if viewer && signOutHref}
			<AvatarMenu {viewer} {profileHref} {settingsHref} {signOutHref} />
		{/if}
	</div>
</header>
