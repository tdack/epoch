/**
 * Whether the viewer has a reason to open the Trees page: the install owner manages every tree
 * there; anyone else only picks a default, which means nothing with a single tree. The menu and
 * the Settings page both ask this, so one never offers a page the other hides.
 */
export function hasTreesPage(isInstallOwner: boolean, treeCount: number): boolean {
	return isInstallOwner || treeCount > 1;
}
