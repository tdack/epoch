<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';
	import Popover from '#lib/components/layout/Popover.svelte';
	import { isManagerOrAbove, type TreeRole } from '#lib/shared/roles.js';

	interface Props {
		/** The tree these links belong to. */
		treeId: string;
		/** The viewer's role; managers and owners also get the members and privacy screens. */
		role?: TreeRole;
		/** The current path, so the section the viewer is in reads as active. */
		pathname: string;
	}

	let { treeId, role, pathname }: Props = $props();

	interface NavLink {
		href: string;
		label: string;
		isActive: boolean;
	}

	const base = $derived(`/trees/${encodeURIComponent(treeId)}`);
	const startsWith = (path: string) => pathname.startsWith(path);
	const tabs = $derived<NavLink[]>([
		{ href: base, label: 'Tree', isActive: pathname === base },
		{ href: `${base}/people`, label: 'People', isActive: pathname === `${base}/people` },
		{ href: `${base}/unions`, label: 'Partnerships', isActive: pathname === `${base}/unions` },
		{ href: `${base}/sources`, label: 'Sources', isActive: startsWith(`${base}/sources`) },
		{ href: `${base}/places`, label: 'Places', isActive: startsWith(`${base}/place`) }
	]);
	const research = $derived<NavLink[]>([
		{ href: `${base}/notes`, label: 'Notes', isActive: startsWith(`${base}/notes`) },
		{ href: `${base}/tasks`, label: 'Tasks', isActive: startsWith(`${base}/tasks`) },
		{
			href: `${base}/relationship`,
			label: 'Relationship',
			isActive: startsWith(`${base}/relationship`)
		},
		{ href: `${base}/surnames`, label: 'Surnames', isActive: startsWith(`${base}/surnames`) },
		{ href: `${base}/quality`, label: 'Quality', isActive: startsWith(`${base}/quality`) },
		{ href: `${base}/search`, label: 'Fact search', isActive: startsWith(`${base}/search`) }
	]);
	const manage = $derived<NavLink[]>(
		isManagerOrAbove(role)
			? [
					{ href: `${base}/members`, label: 'Members', isActive: startsWith(`${base}/members`) },
					{ href: `${base}/privacy`, label: 'Privacy', isActive: startsWith(`${base}/privacy`) }
				]
			: []
	);
	const activeInMore = $derived([...research, ...manage].find((link) => link.isActive));

	const tabClass = (isActive: boolean) =>
		`shrink-0 rounded-lg px-3 py-1.5 font-semibold whitespace-nowrap ${
			isActive ? 'bg-emerald-800 text-white' : 'text-stone-700 hover:bg-stone-200'
		}`;
	const itemClass = (isActive: boolean) =>
		`block px-3 py-2 text-xs font-medium hover:bg-stone-100 focus:bg-stone-100 focus:outline-none ${
			isActive ? 'font-semibold text-emerald-900' : ''
		}`;
</script>

<!-- The tabs scroll sideways on a phone rather than wrapping into a second and third row. -->
<!-- The menu sits beside the scrolling row, not in it: a scroll container would clip its panel. -->
<nav aria-label="Tree sections" class="flex items-center gap-1 text-sm">
	<div class="flex min-w-0 items-center gap-1 overflow-x-auto">
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
	<Popover label="More sections" align="end" panelClass="w-48 py-1">
		{#snippet trigger(attrs)}
			<button
				type="button"
				{...attrs}
				class="{tabClass(!!activeInMore)} flex cursor-pointer items-center gap-1"
			>
				{activeInMore ? `More: ${activeInMore.label}` : 'More'}
				<ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
			</button>
		{/snippet}
		<div role="group" aria-label="Research">
			<p class="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-stone-500 uppercase">
				Research
			</p>
			{#each research as link (link.href)}
				<a
					href={link.href}
					role="menuitem"
					aria-current={link.isActive ? 'page' : undefined}
					class={itemClass(link.isActive)}>{link.label}</a
				>
			{/each}
		</div>
		{#if manage.length > 0}
			<div role="group" aria-label="Manage" class="mt-1 border-t border-stone-200">
				<p
					class="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider text-stone-500 uppercase"
				>
					Manage
				</p>
				{#each manage as link (link.href)}
					<a
						href={link.href}
						role="menuitem"
						aria-current={link.isActive ? 'page' : undefined}
						class={itemClass(link.isActive)}>{link.label}</a
					>
				{/each}
			</div>
		{/if}
	</Popover>
</nav>
