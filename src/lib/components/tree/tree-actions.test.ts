import { describe, expect, it, vi } from 'vitest';
import { personMenuItems, unionMenuItems } from './tree-actions';

const anna = { id: 'p1', displayName: 'Anna' };

describe('personMenuItems', () => {
	it('lists only what the page allows, in the order the menu is laid out', () => {
		const all = personMenuItems(anna, true, {
			onOpenPerson: vi.fn(),
			onOpenProfile: vi.fn(),
			onEditPerson: vi.fn(),
			onAddRelationship: vi.fn(),
			onRecordDeath: vi.fn(),
			onEndPartnership: vi.fn(),
			onDeletePerson: vi.fn()
		});
		expect(all.map((i) => i.label)).toEqual([
			'Show details',
			'Edit person',
			'Add relationship',
			'End partnership…',
			'Record death…',
			'Open full page',
			'Delete person…'
		]);
		expect(all.at(-1)?.isDanger).toBe(true);
		expect(personMenuItems(anna, true, {})).toEqual([]);
	});

	it('offers ending a partnership only to someone who has one', () => {
		const actions = { onEndPartnership: vi.fn() };
		expect(personMenuItems(anna, false, actions)).toEqual([]);
		personMenuItems(anna, true, actions)[0].onClick();
		expect(actions.onEndPartnership).toHaveBeenCalledWith('p1');
	});

	it('opens the drawer and the full page as two entries', () => {
		const actions = { onOpenPerson: vi.fn(), onOpenProfile: vi.fn() };
		const [details, fullPage] = personMenuItems(anna, false, actions);
		details.onClick();
		expect(actions.onOpenPerson).toHaveBeenCalledWith('p1');
		expect(actions.onOpenProfile).not.toHaveBeenCalled();
		fullPage.onClick();
		expect(actions.onOpenProfile).toHaveBeenCalledWith('p1');
	});

	it('hands the person to Add relationship', () => {
		const onAddRelationship = vi.fn();
		personMenuItems(anna, false, { onAddRelationship })[0].onClick();
		expect(onAddRelationship).toHaveBeenCalledWith(anna);
	});
});

describe('unionMenuItems', () => {
	it('offers a merge only for a partnership that has a twin', () => {
		const actions = {
			onEditUnion: vi.fn(),
			onMergeUnion: vi.fn(),
			onRemoveUnion: vi.fn(),
			mergeableUnionIds: new Set(['u2'])
		};
		expect(unionMenuItems('u1', actions).map((i) => i.label)).toEqual([
			'Edit partnership…',
			'Delete partnership…'
		]);
		expect(unionMenuItems('u2', actions).map((i) => i.label)).toContain(
			'Merge duplicate partnerships…'
		);
	});
});
