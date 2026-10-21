/**
 * The editing actions a tree canvas offers on a card or a partnership, and the menu entries that
 * reach them. Shared by all three views so a person's menu is the same wherever they right-click.
 */

import type { MenuItem } from './tree-view.js';

export interface PersonRef {
	id: string;
	displayName: string;
}

/** What the page lets a canvas do; an absent callback leaves its entry out. */
export interface TreeEditActions {
	/** "Show details": open the person in the drawer. */
	onOpenPerson?: (id: string) => void;
	/** "Open full page": go to the person's own page, as the drawer's link of that name does. */
	onOpenProfile?: (id: string) => void;
	onEditPerson?: (id: string) => void;
	onDeletePerson?: (id: string) => void;
	onAddRelationship?: (anchor: PersonRef) => void;
	onRecordDeath?: (id: string) => void;
	/** The caller asks which partnership if there are several. */
	onEndPartnership?: (id: string) => void;
	onEditUnion?: (unionId: string) => void;
	onEndUnion?: (unionId: string) => void;
	onRemoveUnion?: (unionId: string) => void;
	/** Offered only for a partnership that has a twin. */
	onMergeUnion?: (unionId: string) => void;
	/** Unions that have a twin between the same people, and so can be merged. */
	mergeableUnionIds?: ReadonlySet<string>;
}

export function personMenuItems(
	person: PersonRef,
	hasPartnerships: boolean,
	actions: TreeEditActions
): MenuItem[] {
	const items: MenuItem[] = [];
	const { onOpenPerson, onOpenProfile, onEditPerson, onAddRelationship } = actions;
	if (onOpenPerson) items.push({ label: 'Show details', onClick: () => onOpenPerson(person.id) });
	if (onEditPerson) items.push({ label: 'Edit person', onClick: () => onEditPerson(person.id) });
	if (onAddRelationship)
		items.push({ label: 'Add relationship', onClick: () => onAddRelationship(person) });
	const { onRecordDeath, onEndPartnership, onDeletePerson } = actions;
	if (onEndPartnership && hasPartnerships) {
		items.push({ label: 'End partnership…', onClick: () => onEndPartnership(person.id) });
	}
	if (onRecordDeath)
		items.push({ label: 'Record death…', onClick: () => onRecordDeath(person.id) });
	if (onOpenProfile)
		items.push({ label: 'Open full page', onClick: () => onOpenProfile(person.id) });
	if (onDeletePerson)
		items.push({
			label: 'Delete person…',
			isDanger: true,
			onClick: () => onDeletePerson(person.id)
		});
	return items;
}

export function unionMenuItems(unionId: string, actions: TreeEditActions): MenuItem[] {
	const items: MenuItem[] = [];
	const { onEditUnion, onEndUnion, onMergeUnion, onRemoveUnion } = actions;
	if (onEditUnion) items.push({ label: 'Edit partnership…', onClick: () => onEditUnion(unionId) });
	if (onEndUnion) items.push({ label: 'End partnership…', onClick: () => onEndUnion(unionId) });
	if (onMergeUnion && actions.mergeableUnionIds?.has(unionId)) {
		items.push({ label: 'Merge duplicate partnerships…', onClick: () => onMergeUnion(unionId) });
	}
	if (onRemoveUnion)
		items.push({
			label: 'Delete partnership…',
			isDanger: true,
			onClick: () => onRemoveUnion(unionId)
		});
	return items;
}
