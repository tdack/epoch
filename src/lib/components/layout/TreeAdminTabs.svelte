<script lang="ts">
	import PageTabs from '#lib/components/layout/PageTabs.svelte';
	import { isManagerOrAbove, type TreeRole } from '#lib/shared/roles.js';

	interface Props {
		/** The tree's own path (`treePath`), without a sub-tree lens: every tab is about the whole tree. */
		base: string;
		/** Which tab is showing. */
		current: 'settings' | 'subtrees' | 'export' | 'members' | 'audit';
		/** The viewer's role: an editor reads the audit log and administers nothing else. */
		role: TreeRole | undefined;
	}

	let { base, current, role }: Props = $props();

	// The gear in the tree switcher opens these, so a tree's administration is one place (ADR-075).
	const tabs = $derived(
		[
			...(isManagerOrAbove(role)
				? ([
						['settings', `${base}/settings`, 'Settings'],
						['subtrees', `${base}/settings#subtrees`, 'Sub-trees'],
						['export', `${base}/settings#export`, 'Export'],
						['members', `${base}/members`, 'Members']
					] as const)
				: []),
			['audit', `${base}/audit`, 'Audit log'] as const
		].map(([id, href, label]) => ({ href, label, isCurrent: id === current }))
	);
</script>

<PageTabs label="Tree administration" {tabs} />
