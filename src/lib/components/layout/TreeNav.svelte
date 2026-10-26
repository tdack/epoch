<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import { fadeWhenClipped } from '#lib/components/layout/fade-when-clipped.js';
	import type { TreeRole } from '#lib/shared/roles.js';
	import { treePath } from '#lib/shared/tree-slug.js';

	interface Props {
		/** The tree these links belong to. */
		treeId: string;
		/** The tree's slug, for the links this builds (ADR-045); without one they use the id. */
		treeSlug?: string | null;
		/** The viewer's role; any member also gets Files. */
		role?: TreeRole;
		/** The current path, so the section the viewer is in reads as active. */
		pathname: string;
		/** Reading the public tree without membership: the working screens (tasks, quality) are for members. */
		isOutsider?: boolean;
		/**
		 * On a tree's own subdomain, the app host's origin: the Files page spans trees, so it is
		 * served there instead. Absent on the app host.
		 */
		appOrigin?: string;
	}

	let {
		treeId,
		treeSlug = null,
		role,
		pathname,
		isOutsider = false,
		appOrigin = ''
	}: Props = $props();

	interface NavLink {
		href: string;
		label: string;
		isActive: boolean;
	}

	const base = $derived(treePath({ id: treeId, slug: treeSlug }));
	const startsWith = (path: string) => pathname.startsWith(path);
	const tabs = $derived<NavLink[]>([
		{ href: base, label: 'Tree', isActive: pathname === base },
		{ href: `${base}/people`, label: 'People', isActive: pathname === `${base}/people` },
		{ href: `${base}/unions`, label: 'Partnerships', isActive: pathname === `${base}/unions` },
		{ href: `${base}/places`, label: 'Places', isActive: startsWith(`${base}/place`) }
	]);
	const research = $derived<NavLink[]>([
		{ href: `${base}/sources`, label: 'Sources', isActive: startsWith(`${base}/sources`) },
		// Any member may open the Files manager: what it lists and changes is decided per file on the server.
		...(role && !isOutsider
			? [
					{
						href: `${appOrigin}${base}/files`,
						label: 'Files',
						isActive: startsWith(`${base}/files`)
					}
				]
			: []),
		{ href: `${base}/notes`, label: 'Notes', isActive: startsWith(`${base}/notes`) },
		...(isOutsider
			? []
			: [{ href: `${base}/tasks`, label: 'Tasks', isActive: startsWith(`${base}/tasks`) }]),
		{
			href: `${base}/relationship`,
			label: 'Relationship',
			isActive: startsWith(`${base}/relationship`)
		},
		{ href: `${base}/surnames`, label: 'Surnames', isActive: startsWith(`${base}/surnames`) },
		...(isOutsider
			? []
			: [{ href: `${base}/quality`, label: 'Quality', isActive: startsWith(`${base}/quality`) }]),
		{ href: `${base}/search`, label: 'Fact search', isActive: startsWith(`${base}/search`) }
	]);
	const activeInResearch = $derived(research.find((link) => link.isActive));

	const tabClass = (isActive: boolean) =>
		`focus-ring-inset shrink-0 rounded-lg px-3 py-1.5 font-semibold whitespace-nowrap coarse:inline-flex coarse:min-h-11 coarse:items-center ${
			isActive ? 'bg-emerald-800 text-white' : 'text-stone-700 hover:bg-stone-200'
		}`;
	const itemClass = (isActive: boolean) =>
		`menu-item flex items-center px-3 py-2 text-xs font-medium ${
			isActive ? 'font-semibold text-emerald-900' : ''
		}`;
</script>

<!-- The tabs scroll sideways on a phone rather than wrapping into a second and third row. -->
<!-- The menu sits beside the scrolling row, not in it: a scroll container would clip its panel. -->
<nav aria-label="Tree sections" class="flex items-center gap-1 text-sm">
	<div class="flex min-w-0 items-center gap-1 overflow-x-auto" {@attach fadeWhenClipped}>
		{#each tabs as link (link.href)}
			<a
				href={link.href}
				aria-current={link.isActive ? 'page' : undefined}
				class={tabClass(link.isActive)}
			>
				{link.label}
			</a>
		{/each}
	</div>
	<Popover label="Research" align="end" panelClass="w-48 py-1">
		{#snippet trigger(attrs)}
			<button
				type="button"
				{...attrs}
				class="{tabClass(!!activeInResearch)} inline-flex cursor-pointer items-center gap-1"
			>
				<!-- On a phone the name would push the tabs off; the highlight alone says you are in Research. -->
				Research{#if activeInResearch}<span class="hidden sm:inline"
						>: {activeInResearch.label}</span
					>{/if}
				<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		{/snippet}
		{#each research as link (link.href)}
			<a
				href={link.href}
				role="menuitem"
				aria-current={link.isActive ? 'page' : undefined}
				class={itemClass(link.isActive)}>{link.label}</a
			>
		{/each}
	</Popover>
</nav>
